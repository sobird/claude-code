# Claude Code Remote Control（`src/bridge`）详细设计文档（逆向整理）

> 本文完全由 `src/bridge/**` 源码反推，不假设存在外部设计稿。文中出现的标识符、端点、字段名、环境变量与常量均取自源码原文。
>
> 本文是 `src/bridge` 的单一整合文档：协议全景、认证矩阵、生命周期、并发语义、配置表，以及派发 / 子进程契约 / 不变量等实现级细节。

---

## 1. 概述与目标

Remote Control（下称 “bridge”）把**本机 Claude Code 会话**暴露到 claude.ai/code（Web / iOS / Android）：用户在远端输入提示、审批权限、中断任务，本机执行并把事件流回传。

核心目标：

| 目标                       | 体现                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| 一次登录即可远程接管       | OAuth（claude.ai 订阅）+ GrowthBook 灰度                                                  |
| 会话在远端“可发现、可恢复” | environment 注册、work 派发、`bridge-pointer.json` 崩溃恢复                               |
| 传输可演进                 | v1（Environments API + Session Ingress WS）与 v2（CCR code-sessions + SSE/CCRClient）并行 |
| 本机进程不被打挂           | 所有桥接错误分类为 fatal / transient，fatal 才终止                                        |
| 多会话与隔离               | spawn 模式（`single-session` / `same-dir` / `worktree`）+ 容量上限                        |
| 不污染 Agent SDK 包体      | 重依赖通过注入（`onAuth401`、`getPollIntervalConfig`、`setCseShimGate`）解耦              |

非目标（从代码可见）：

- 不做服务端实现（本仓库只包含客户端与自托管 `packages/rcs`）。
- bridge 不负责模型调用本身，它只搬运 SDK 消息。
- 标题是“装饰性”的，模型永远看不到 session title。

---

## 2. 术语

| 术语                    | 含义                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **environment**         | 一个 bridge 实例在服务端的注册记录（`environment_id` / `environment_secret`）。                                                                                                       |
| **work**                | 服务端派发的一个工作单元，`data.type ∈ {session, healthcheck}`。                                                                                                                      |
| **session**             | 一次具体的 Claude Code 对话；远端通过它投递消息。                                                                                                                                     |
| **Session Ingress**     | v1 的事件通道（WebSocket 读 + HTTP POST 写）。                                                                                                                                        |
| **CCR**                 | Claude Code Runner；v2 的 `/worker/*` API 与 SSE 流。                                                                                                                                 |
| **env-less**            | 不注册 environment、不轮询 work，直接 `POST /v1/code/sessions` → `POST /bridge` 的 v2 REPL 路径。**注意：env-less ≠ CCR v2**，v1 路径也能用 CCR v2 传输（`CLAUDE_CODE_USE_CCR_V2`）。 |
| **spawn mode**          | 新会话的工作目录策略：`single-session` / `same-dir` / `worktree`。                                                                                                                    |
| **`cse_` / `session_`** | 同一 UUID 的两种“戏服”（tagged ID）：worker 端点认 `cse_`，compat/client 端点认 `session_`。                                                                                          |
| **worker_epoch**        | v2 worker 的纪元号；每次 `POST /bridge` 都自增，旧 epoch 立即失效。                                                                                                                   |
| **perpetual**           | 常驻 bridge（assistant/KAIROS 场景），退出时只做本地清理、不 archive/deregister。                                                                                                     |

---

## 3. 总体架构

### 3.1 四条接入路径

```
                        ┌──────────────────────────────────────────────┐
   (A) claude remote-control ──► bridgeMain.ts  (spawn 模式 / 多会话)  │
                        │                                              │
   (B) REPL /remote-control ──► initReplBridge.ts                     │
                        │        ├─ v1: replBridge.ts (env-based)      │
                        │        └─ v2: remoteBridgeCore.ts (env-less) │
                        │                                              │
   (C) print / SDK -p ────► initReplBridge.ts (同一 v1/v2 core)       │
                        │                                              │
   (D) headless daemon ───► bridgeMain.runBridgeHeadless (env-based)  │
                        └──────────────────────────────────────────────┘
```

| 路径        | 入口                                           | 有 environment? | 有 poll? | 传输                                | 典型 Gate                                             |
| ----------- | ---------------------------------------------- | --------------- | -------- | ----------------------------------- | ----------------------------------------------------- |
| A 独立模式  | `claude remote-control` → `bridgeMain.ts`      | 是              | 是       | v1 WS 或 v2（`use_code_sessions`）  | `tengu_ccr_bridge` + `tengu_ccr_bridge_multi_session` |
| B REPL v1   | `/remote-control` → `initBridgeCore`           | 是              | 是       | HybridTransport / v2 repl transport | `tengu_bridge_repl_v2=false`                          |
| B REPL v2   | `/remote-control` → `initEnvLessBridgeCore`    | **否**          | **否**   | `SSETransport + CCRClient`          | `tengu_bridge_repl_v2=true` 且非 `perpetual`          |
| C SDK/print | `query.enableRemoteControl` → `initReplBridge` | 同上            | 同上     | 同上                                | 同上                                                  |
| D headless  | `runBridgeHeadless`                            | 是              | 是       | v1/v2                               | 由 daemon/serve 调用                                  |

### 3.2 控制平面 vs 数据平面

- **控制平面**：environment 注册、work 轮询/确认/停止、心跳、deregister、session 创建/归档/重连。用 OAuth token（或 environment/ingress token）。
- **数据平面**：会话消息的读写。v1 走 Session Ingress；v2 走 CCR `/worker/*`。

两者认证来源不同，这是理解整个模块的第一把钥匙。

### 3.3 组件清单（file → 职责）

| 文件                                                                         | 职责                                                                                                 |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `types.ts`                                                                   | 协议类型、`BridgeApiClient`、`SessionHandle`、`SpawnMode`、默认常量（24h 超时）                      |
| `bridgeApi.ts`                                                               | Environments + Sessions 客户端；`withOAuthRetry`；`BridgeFatalError`；`validateBridgeId`；错误码映射 |
| `codeSessionApi.ts`                                                          | `POST /v1/code/sessions`、`POST /v1/code/sessions/{id}/bridge`（v2 凭据）                            |
| `createSession.ts`                                                           | v1 compat `POST /v1/sessions`、`GET/PATCH/archive`；ccr-byoc beta 头 + org UUID                      |
| `bridgeMain.ts`                                                              | 独立多会话服务器：CLI 参数、poll 循环、spawn、看门狗、shutdown、headless                             |
| `replBridge.ts`                                                              | v1 REPL core：注册、poll 循环、传输切换、reconnect、teardown                                         |
| `remoteBridgeCore.ts`                                                        | v2 env-less core：建会话、取凭据、token 刷新、transport 重建、teardown                               |
| `initReplBridge.ts`                                                          | REPL 前置：gates、OAuth 预检、策略、标题、v1/v2 分派                                                 |
| `replBridgeTransport.ts`                                                     | 统一传输接口；v1 适配 HybridTransport；v2 组装 SSE + CCRClient                                       |
| `sessionRunner.ts`                                                           | 子进程 spawn（参数/环境变量）、NDJSON 解析、信号与结果归一                                           |
| `bridgeMessaging.ts`                                                         | 入站消息分发、控制请求处理、echo/重投去重、`BoundedUUIDSet`                                          |
| `bridgeUI.ts` / `bridgeStatusUtil.ts`                                        | ANSI 状态区、二维码、shimmer、多会话列表                                                             |
| `bridgePointer.ts`                                                           | `bridge-pointer.json` 崩溃恢复指针                                                                   |
| `bridgeEnabled.ts` / `envLessBridgeConfig.ts` / `pollConfig.ts`              | 灰度开关与可调参数                                                                                   |
| `workSecret.ts` / `sessionIdCompat.ts`                                       | work secret 解码、ID 重标签、worker 注册                                                             |
| `jwtUtils.ts` / `trustedDevice.ts`                                           | JWT 过期解析与主动刷新；受信设备 token                                                               |
| `flushGate.ts` / `capacityWake.ts`                                           | 初始化刷写闸门；容量休眠早唤醒                                                                       |
| `inboundMessages.ts` / `inboundAttachments.ts` / `webhookSanitizer.ts`       | 入站规范化、附件落盘、凭据脱敏                                                                       |
| `fileSuggestions.ts` / `bridgePlanInput.ts` / `bridgePermissionCallbacks.ts` | `@` 补全、plan 展示、权限回调类型                                                                    |
| `bridgeDebug.ts` / `debugUtils.ts`                                           | 故障注入（ant-only）、日志脱敏/截断                                                                  |
| `replBridgeHandle.ts` / `peerSessions.ts`                                    | 进程级 handle 发布；跨会话消息桩                                                                     |

---

## 4. 核心抽象与标识符

### 4.1 environment 与 work

注册（`POST /v1/environments/bridge`）返回：

```jsonc
{ "environment_id": "env_...", "environment_secret": "<可用于 Bearer 的密钥>" }
```

`BridgeConfig` 中的 `environmentId` 是**客户端生成的 UUID**，仅用于幂等注册；`reuseEnvironmentId` 才是**服务端格式**的 ID（客户端 UUID 会被 400）。二者不可混用。

`WorkResponse`：

```jsonc
{
  "id": "<workId>", "type": "work", "environment_id": "env_...",
  "state": "...", "created_at": "...",
  "data": { "type": "session" | "healthcheck", "id": "<sessionId>" },
  "secret": "<base64url(JSON WorkSecret)>"
}
```

`WorkSecret`（`version` 必须为 1）：

```jsonc
{
  "version": 1,
  "session_ingress_token": "<JWT>",   // 空则拒绝
  "api_base_url": "https://...",       // 缺失则拒绝
  "sources": [...], "auth": [...],
  "claude_code_args": {...} | null,
  "mcp_config": {...} | null,
  "environment_variables": {...} | null,
  "use_code_sessions": true           // 服务端驱动的 CCR v2 选择器
}
```

### 4.2 Session ID 的“双重戏服”

- **`cse_*`**：基础设施/worker 端点（`/v1/code/sessions/{id}/worker/*`）与 work poll 交付的形态。
- **`session_*`**：compat/client 端点（`/v1/sessions/{id}`、`/archive`、`/events`）与 claude.ai 前端路由认的形态。

客户端注释（`src/bridge/sessionIdCompat.ts:31`、`src/bridge/bridgeEnabled.ts:143`、`src/bridge/createSession.ts:336` 等）引用了服务端 `compat/convert.go:27`：它校验 `TagSession`，因此 compat 网关只接受 `session_*`；`convert.go:41` 则把内部 ID 转成 `session_*` 返回给 v1 API 客户端。**该 Go 文件不在本仓库**（本仓库无任何 `.go` 文件），上述行号是注释作者的跨仓库引用，无法在本地核实。同一 UUID，不同服装。

> 同批注释还引用了 `compat/CLAUDE.md:13`、`container_manager.go:129`、`register_worker.go:32`、`environment_auth.py:856`、`work_v1.py:230`、`work_service.py:24` 以及服务端 PR `#292605` / `#293280`，均指向不在本仓库的服务端代码库。

三个工具函数构成整套兼容层：

| 函数                    | 作用                         | 关键约束                                                                                   |
| ----------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| `toCompatSessionId(id)` | `cse_` → `session_`          | 受 kill switch `tengu_bridge_repl_v2_cse_shim_enabled` 控制；非 `cse_` 原样返回            |
| `toInfraSessionId(id)`  | `session_` → `cse_`          | 给 `POST /v1/environments/{id}/bridge/reconnect` 用（它在 compat 层之下，按 infra tag 查） |
| `sameSessionId(a,b)`    | 比较最后一个 `_` 之后的 body | body 长度 ≥ 4，避免短后缀误判                                                              |

**为什么重要**：`replBridge` 用 `sameSessionId` 拒绝“外来会话”；`bridgeMain` 用同一 `sessionId` 变量同时做 worker 注册（要 `cse_`）与 archive（要 `session_`）；`updateBridgeSessionTitle` 内部统一 retag。

### 4.3 worker_epoch 与 sequence num

- **epoch**：`POST /bridge` 每次调用都自增（“the /bridge call IS the register”）。旧 epoch 的任何写操作会被 409 拒绝 → `CCRClient.onEpochMismatch` → 关闭传输并以 `4090` 通知上层，由 poll 循环拿新 work 重建。
- **sequence num**：SSE 高水位。传输替换时必须 `getLastSequenceNum()` 并作为 `initialSequenceNum` 传给新 `SSETransport`，否则服务端从 seq 0 重放整段历史。

### 4.4 两种 token

| token                                  | 来源                                             | 用途                                                                               |
| -------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| OAuth access token                     | 本地 keychain / `CLAUDE_BRIDGE_OAUTH_TOKEN`(ant) | Environments API、Sessions API、Code Sessions API，以及 v1 REPL 的 Session Ingress |
| `session_ingress_token` / `worker_jwt` | work secret / `POST /bridge`                     | spawn 子进程的 `CLAUDE_CODE_SESSION_ACCESS_TOKEN`；v2 的 `/worker/*`               |

v2 端点校验 JWT 的 `session_id` claim 与 worker role；OAuth token 两者皆无 → 必须用 JWT。v1 恰好相反（`replBridgeTransport.ts` 注释明确：v1 有意使用 OAuth）。

---

## 5. 协议与 API

### 5.1 Environments API（`bridgeApi.ts`）

公共头：

```
Authorization: Bearer <token>       # OAuth 或 environment_secret / session_ingress_token
Content-Type: application/json
anthropic-version: 2023-06-01
anthropic-beta: environments-2025-11-01
x-environment-runner-version: <runnerVersion>
X-Trusted-Device-Token: <token>     # 可选，受 gate 控制
```

| 方法/路径                                                       | 认证                      | 请求                                                                                                     | 响应                                                   |
| --------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `POST /v1/environments/bridge`                                  | OAuth                     | `{machine_name, directory, branch, git_repo_url, max_sessions, metadata:{worker_type}, environment_id?}` | `{environment_id, environment_secret}`                 |
| `GET /v1/environments/{envId}/work/poll?reclaim_older_than_ms=` | environment_secret        | —                                                                                                        | `WorkResponse \| null`                                 |
| `POST /v1/environments/{envId}/work/{workId}/ack`               | session ingress token     | `{}`                                                                                                     | 204                                                    |
| `POST /v1/environments/{envId}/work/{workId}/stop`              | OAuth（`withOAuthRetry`） | `{force}`                                                                                                | 204                                                    |
| `DELETE /v1/environments/bridge/{envId}`                        | OAuth                     | —                                                                                                        | 204                                                    |
| `POST /v1/environments/{envId}/bridge/reconnect`                | OAuth                     | `{session_id}`                                                                                           | 204                                                    |
| `POST /v1/environments/{envId}/work/{workId}/heartbeat`         | session ingress token     | `{}`                                                                                                     | `{lease_extended, state, last_heartbeat, ttl_seconds}` |
| `POST /v1/sessions/{sessionId}/events`                          | session ingress token     | `{events:[...]}`                                                                                         | 204                                                    |

要点：

- **`withOAuthRetry`**：仅在 401 时调用注入的 `onAuth401`（`handleOAuth401Error`）刷新，成功则重试一次；daemon 使用环境变量 token 时不注入该回调，401 直接变 `BridgeFatalError`。
- **`validateBridgeId`**：`/^[a-zA-Z0-9_-]+$/`，防止 `../../admin` 路径穿越。
- **空轮询日志**：第 1 次与每第 100 次打印，避免刷屏。
- **`archiveSession`**：409 视为“已归档”，幂等返回。
- **错误映射**：401→登录提示；403 expired→会话过期；404；410；429→“轮询过频”；其余 5xx 交给上层退避。

### 5.2 Sessions API（v1 compat，`createSession.ts`）

头：`anthropic-beta: ccr-byoc-2025-07-29` + `x-organization-uuid`（自托管固定 `self-hosted`）。

| 方法/路径                        | 请求                                                                                                                      | 响应                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `POST /v1/sessions`              | `{title?, events, session_context:{sources, outcomes, model}, environment_id, source:'remote-control', permission_mode?}` | `{id}`                      |
| `GET /v1/sessions/{id}`          | —                                                                                                                         | `{environment_id?, title?}` |
| `POST /v1/sessions/{id}/archive` | `{}`                                                                                                                      | 200；409 幂等               |
| `PATCH /v1/sessions/{id}`        | `{title}`                                                                                                                 | 200                         |

`session_context` 由 git 信息构造：

```jsonc
sources: [{type:'git_repository', url:'https://github.com/o/r', revision:'<branch|default>'}]
outcomes:[{type:'git_repository', git_info:{type:'github', repo:'o/r', branches:['claude/<branch|task>']}}]
model: getMainLoopModel()
```

事件按 `{ type: 'event', data: <SDKMessage> }` 包装（判别联合格式）。

### 5.3 Code Sessions API（v2，`codeSessionApi.ts`）

| 方法/路径                            | 请求                        | 响应                                                   |
| ------------------------------------ | --------------------------- | ------------------------------------------------------ |
| `POST /v1/code/sessions`             | `{title, bridge:{}, tags?}` | `{session:{id:'cse_*'}}`                               |
| `POST /v1/code/sessions/{id}/bridge` | `{}`（可带设备 token）      | `{worker_jwt, api_base_url, expires_in, worker_epoch}` |

要点：

- `bridge: {}` 是 oneof runner 的**正向信号**；省略会 400。
- `worker_epoch` 可能是 string（protojson int64）或 number，必须 `Number.isSafeInteger` 校验。
- **JWT 不透明，禁止解码**（注释明确）。

### 5.4 CCR v2 Worker API

`sessionUrl = buildCCRv2SdkUrl(api_base_url, sessionId)` → `{base}/v1/code/sessions/{id}`。

由 `SSETransport` + `CCRClient`（`src/cli/transports/`）实现：

| 能力                                | 说明                                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------- | ------------------------ |
| `registerWorker(sessionUrl, token)` | `POST {sessionUrl}/worker/register` → `worker_epoch`                                                |
| SSE 读流                            | `{sessionUrl}/worker/events/stream`，支持 `Last-Event-ID` / `from_sequence_num`                     |
| 写事件                              | `writeEvent` → `POST {sessionUrl}/worker/events`（`SerialBatchEventUploader`，maxBatchSize=100）    |
| 投递回执                            | `POST {sessionUrl}/worker/events/{event_id}/delivery`，状态 `received` / `processing` / `processed` |
| 会话状态                            | `reportState('running'                                                                              | 'requires_action' | 'idle')`→`/worker/state` |
| 元数据                              | `reportMetadata({...})` → `/worker/external_metadata`                                               |
| 心跳                                | CCRClient 定时心跳（默认 20s ±10%，服务端 TTL 60s）                                                 |

v2 的写路径**不走** SSE，SSE 只负责读。

### 5.5 Session Ingress v1（WebSocket）

`buildSdkUrl(apiBaseUrl, sessionId)`：

```
协议：https → wss，否则 ws（跟随 base URL scheme，而非 host）
版本：localhost / 127.0.0.1 → /v2/（直连 session-ingress）
      其他（生产）          → /v1/（Envoy 重写为 /v2/）
路径：{ws(s)}://{host}/{v1|v2}/session_ingress/ws/{sessionId}
```

`HybridTransport`：WS 读，HTTP POST 写。REPL 侧配置 `maxConsecutiveFailures: 50`、`isBridge: true`，并通过 `droppedBatchCount` 检测“静默丢弃”（`writeBatch` 即使丢弃也正常 resolve）。

### 5.6 辅助 API

| 路径                                       | 用途                                            |
| ------------------------------------------ | ----------------------------------------------- |
| `GET /api/oauth/files/{file_uuid}/content` | 下载入站附件（cookie 上传、oauth 读取同一存储） |
| `POST /api/auth/trusted_devices`           | 受信设备登记（要求会话创建 ≤10 分钟）           |
| `/api/oauth/profile`                       | 提供 `organizationUuid`（GrowthBook 定向依据）  |

---

## 6. 认证与安全模型

### 6.1 认证矩阵

| 调用                                                            | 凭据                                                                          |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| register / stop / deregister / reconnect / archive(title PATCH) | OAuth access token                                                            |
| poll / ack / heartbeat / events                                 | `environment_secret` 或 `session_ingress_token`                               |
| `POST /v1/sessions*`                                            | OAuth + `x-organization-uuid`                                                 |
| `POST /v1/code/sessions*`                                       | OAuth（可加受信设备头）                                                       |
| `/worker/*`                                                     | `worker_jwt` / `session_ingress_token`（含 `session_id` claim + worker role） |
| v1 REPL Session Ingress                                         | OAuth（有意为之）                                                             |
| spawn 子进程                                                    | `CLAUDE_CODE_SESSION_ACCESS_TOKEN`（ingress token）                           |
| daemon/多会话                                                   | 每实例 `getAuthToken` 闭包，避免写进程级 env                                  |

### 6.2 受信设备（Trusted Device）

- 服务端对 bridge 会话标记 `SecurityTier=ELEVATED`；当 enforcement 开启，`ConnectBridgeWorker` 要求受信设备。
- CLI 侧 gate：`tengu_sessions_elevated_auth_enforcement`（每次调用实时读取）。
- token 存 keychain（memoized）；登记窗口：登录后 10 分钟内新建的会话才可登记；使用环境变量 token 时跳过。
- 下发给 `POST /v1/environments/bridge` 与 `POST /v1/code/sessions/{id}/bridge` 的 `X-Trusted-Device-Token`。

### 6.3 其它防护

| 风险                         | 措施                                                                                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL 路径注入                 | `validateBridgeId` 白名单                                                                                                                                                               |
| OAuth token 经子进程泄漏     | spawn 时剥离 `CLAUDE_CODE_OAUTH_TOKEN`                                                                                                                                                  |
| worker JWT 泄漏给 MCP server | v2 用每实例 `getAuthToken` 闭包，不写 `CLAUDE_CODE_SESSION_ACCESS_TOKEN`                                                                                                                |
| Webhook 内容带凭据           | `sanitizeInboundWebhookContent`：GitHub/Anthropic/AWS/npm/Slack/Bearer/generic kv 全部脱敏，剥离 C0 控制字符（保留 `\t\n\r`），超 100KB 截断；先脱敏后截断，避免 token 被截断成半截逃逸 |
| 附件文件名注入               | `basename()` + 白名单字符 + `file_uuid` 前缀，落盘到 `~/.claude/uploads/{sessionId}/`                                                                                                   |
| 日志泄漏                     | `redactSecrets` / `debugBody`：`session_ingress_token`、`environment_secret`、`access_token`、`secret`、`token` 截断脱敏                                                                |
| 明文传输                     | 非 localhost 的 base URL 要求 HTTPS                                                                                                                                                     |

---

## 7. 生命周期与状态机

### 7.1 路径 A：独立 `claude remote-control`

CLI 关键参数（`bridgeMain.ts`）：`--spawn`、`--capacity`、`--create-session-in-dir`、`--session-id`、`--continue`、`--session-timeout`（秒）、`--debug-file`、`--verbose`。

```
启动
 ├─ isBridgeEnabledBlocking()
 ├─ OAuth 预刷新（避免首次注册带过期 token → 401）
 ├─ 解析 spawn mode（首次运行弹框并持久化；运行时按 `w` 切换）
 ├─ register environment ──► env_id, env_secret
 └─ runBridgeLoop()
      ├─ at capacity? ──sleep(at_capacity, capacityWake)──┐
      ├─ poll(work)  ◄───────────────────────────────────┘
      │    ├─ work.id ∈ completedWorkIds → 跳过（服务端陈旧重投）
      │    ├─ healthcheck → ack → 继续
      │    ├─ 未知 type → ack → 忽略（为服务端新类型留向前兼容）
      │    └─ session:
      │         decodeWorkSecret（失败 → completedWorkIds + OAuth stopWork，防 XAUTOCLAIM 死循环）
      │         ├─ 已存在该会话 handle → updateAccessToken + 重排 token 刷新 → ack
      │         ├─ 已满容量 → 不 ack、不 spawn（留给后续轮次）
      │         └─ 新会话:
      │              ack（“提交后才确认”）
      │              v2 时 registerWorker → worker_epoch（2 次尝试，间隔 2s）
      │              worktree 模式下创建独立 git worktree（初始会话除外）
      │              spawn 子进程（sessionRunner）
      │              记录 title（首条用户消息，80 字符）
      │              启动超时看门狗（默认 24h）
      │              on done: completed/failed/interrupted
      │                  → 非 interrupted 才 stopWorkWithRetry (1s/2s/4s)
      │                  → 清理 worktree / 从映射移除 / capacityWake.wake()
      └─ 错误:
           fatal(BridgeFatalError) → 终止
           connection(ECONNREFUSED/ECONNRESET/ETIMEDOUT/ENETUNREACH/EHOSTUNREACH)
                  → 2s → 120s，600s 放弃
           general → 500ms → 30s，600s 放弃（±25% jitter）
```

关闭序列：`SIGTERM` →（宽限 30s）→ `SIGKILL` → 清 timer → worktree 清理 → `stopWork` → 等待 pendingCleanups → `deregisterEnvironment` → `clearBridgePointer`。

`--session-id` 恢复（KAIROS gated）：`getBridgeSession` → 取 `environment_id` → 以 `reuseEnvironmentId` 重新注册 → `reconnectSession`（先 `session_*` 再 `cse_*`）。

**为什么 ack 在 spawn 之前**：`ackWork` 在通过容量守卫、确定要处理之后、真正 spawn 之前调用（源码注释：“Explicitly acknowledge after committing to handle the work — NOT before”）。满载分支直接 `break`、**不 ack**，否则 work 会被永久丢弃；ack 失败视为非致命（服务端会重投，由 `existingHandle` / `completedWorkIds` 去重）。spawn / register / worktree 等后续失败则一律 `completedWorkIds.add` + `stopWorkWithRetry`。

**毒化 work**：`decodeWorkSecret` 失败时拿不到 JWT 无法 ack，于是标记 completed 并用 OAuth 鉴权的 `stopWork` 结束它，避免 `reclaim_older_than_ms`（5s）触发 XAUTOCLAIM 反复投递。

**满载与 token 刷新**：容量检查在分派前，但 `case 'session'` 会**先**处理已有会话的 token 刷新（`updateAccessToken` + `tokenRefresh.schedule`）再撞容量守卫——所以满载时旧会话的 token 不会被饿死。分派之后再统一睡：`non_exclusive_heartbeat_interval_ms > 0` 走心跳循环，否则用 `multisession_poll_interval_ms_at_capacity`；睡眠接入 `capacityWake`，任一会话结束立即唤醒重新轮询。

**子进程 spawn 契约**（`sessionRunner.ts`）：

```
argv: [ ...scriptArgs, '--print', '--sdk-url', sdkUrl, '--session-id', sessionId,
        '--input-format','stream-json', '--output-format','stream-json',
        '--replay-user-messages', (--verbose | --debug-file | --permission-mode …) ]
env : 移除 CLAUDE_CODE_OAUTH_TOKEN
      设置 CLAUDE_CODE_ENVIRONMENT_KIND='bridge'
           CLAUDE_CODE_SESSION_ACCESS_TOKEN=<ingress token>
           CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2='1'
      v2 额外：CLAUDE_CODE_USE_CCR_V2='1'、CLAUDE_CODE_WORKER_EPOCH=<epoch>
```

token 轮换通过 stdin 下发：`{type:'update_environment_variables', variables:{CLAUDE_CODE_SESSION_ACCESS_TOKEN:'<new>'}}`。子进程退出结果归一为 `completed | failed | interrupted`。

**会话结束清理**（`onSessionDone`）：删除 `activeSessions / sessionStartTimes / sessionWorkIds / sessionIngressTokens / sessionCompatIds / titledSessions / v2Sessions`，清看门狗 timer、`tokenRefresh.cancel`、`capacityWake.wake()`。看门狗超时导致的 `interrupted` 记为 `failed`，从而仍会 `stopWork`。多会话模式保持循环继续运行且**不 archive**（会话保持可恢复）；single-session 则 `controller.abort()` 结束整个 bridge。

### 7.2 路径 B1：REPL v1（`initBridgeCore`）

```
init ReplBridge 前置（initReplBridge.ts）:
  1. isBridgeEnabledBlocking
  2. getBridgeAccessToken（无 → failed '/login'）
  3. policy: allow_remote_control
  3a. 跨进程死 token 退避（bridgeOauthDeadExpiresAt, count ≥ 3 → 静默跳过）
  3b. checkAndRefreshOAuthTokenIfNeeded
  3c. 仍过期且刷新失败 → 记录死 token，跳过（避免无限 401）
  4. baseUrl / title / orgUUID
  5. 分支：isEnvLessBridgeEnabled() && !perpetual → v2，否则 v1
```

```
initBridgeCore:
  ├─ register（若 pointer 指向活 env，tryReconnectInPlace 复用）
  ├─ createSession（events: []，随后刷历史）
  ├─ writeBridgePointer({sessionId, environmentId, source:'repl'})
  ├─ startWorkPollLoop:
  │     not_at_capacity 2s / at_capacity 600s
  │     POLL_ERROR 退避 2s → 60s → 15min
  │     容量满时心跳（non_exclusive_heartbeat_interval_ms）
  │     挂起检测（>60s 睡眠超时视为系统休眠）
  │     onHeartbeatFatal / onEnvironmentLost → doReconnect
  │     每轮 work：decodeWorkSecret（失败 → OAuth stopWork 结束毒化 work）
  │               → ackWork（失败非致命，服务端重投由去重兜底）
  └─ onWorkReceived（work 已被 ack）:
        ├─ sameSessionId 拒绝外来会话（拒绝发生在 ack 之后）
        ├─ 选择传输:
        │    v1: HybridTransport({maxConsecutiveFailures:50, isBridge:true})
        │    v2: createV2ReplTransport({initialSequenceNum})（内部 registerWorker；
        │         epoch 参数仅供 v2 env-less 路径，v2Generation 是本地握手代际校验）
        ├─ flushGate.start()
        │     写初始历史（cap = tengu_bridge_initial_history_cap，默认 200；
        │                排除 previouslyFlushedUUIDs）
        ├─ flushGate.end() → 排空队列
        └─ 接线 onData/onClose/onConnect
```

重连（`doReconnect`）：

1. **Strategy 1**：reuseEnvironmentId + `reconnectSession`（原地复用）。
2. **Strategy 2**：archive 旧会话 + 新建会话。
3. `MAX_ENVIRONMENT_RECREATIONS = 3`；重连时重置 seq、UUID 集合、标题锁存。

teardown 顺序（严格）：

```
result 事件
 → stopWork + archive 并行（archive ≤1.5s）
 → transport.close()
 → deregisterEnvironment
 → clearBridgePointer
（perpetual: 只做本地清理并刷新 pointer mtime，不 stop/archive/deregister；服务端靠 lease TTL 重新挂起 work）
```

### 7.3 路径 B2：REPL v2 env-less（`initEnvLessBridgeCore`）

```
withRetry( createCodeSession )                 # 3 次，500ms 基数，±25%，上限 4s
  → cse_* sessionId
withRetry( fetchRemoteCredentials /bridge )    # worker_jwt + api_base_url + expires_in + epoch
  → createV2ReplTransport({
        sessionUrl: buildCCRv2SdkUrl(api_base_url, cse_id),
        epoch,                                  # /bridge 已经 register
        getAuthToken: () => currentJwt,        # 闭包，不写 env
        outboundOnly?                           # mirror 模式
    })
  → connect():
        void sse.connect()                      # outboundOnly 时跳过
        ccr.initialize(epoch) → onConnect
  → reportState('running' if mid-turn else 'idle')
  → flushGate 刷历史 → drain
```

运行时：

- **Token 刷新**：`expires_in - 300s` 时主动重取 `/bridge` → `rebuildTransport`。`authRecoveryInFlight` 闩锁防止并发重复取凭据（重复 `/bridge` 会再次 bump epoch）。
- **传输重建**：`flushGate` 保持排队、携带 `initialSequenceNum`、重新武装 15s connect deadline、排空。
- **onClose**：401 → `recoverFromAuthFailure`（重置 `initialFlushDone`，重取凭据）；否则 failed。
- **handle 方法**：恢复期间丢弃入站写入，避免写进死传输。

teardown：

```
reportState('idle')
 → result 事件
 → archive（401 时重试一次；timeout 1500ms）
 → transport.close()
（archive 状态上报遥测）
```

### 7.4 路径 C/D：print / SDK / headless

- `print.ts` 通过 `query.enableRemoteControl` 复用 `initReplBridge`，无 REPL 消息数组时 count-3 退化为单条文本。
- `runBridgeHeadless` 复用 `bridgeMain` 的环境逻辑，使用 `createHeadlessBridgeLogger`；致命错误抛 `BridgeHeadlessPermanentError`。
- daemon 不读 `sessionStorage`，因此 `initBridgeCore` 与 `initReplBridge` 被拆开（控制 Agent SDK bundle 体积）。

### 7.5 状态机与关闭码

UI 状态（`bridgeStatusUtil.ts`）：

```ts
type StatusState = 'idle' | 'attached' | 'titled' | 'reconnecting' | 'failed'
```

`getBridgeStatus` 映射：

| 条件                           | 标签                        | 颜色    |
| ------------------------------ | --------------------------- | ------- |
| `error`                        | Remote Control failed       | error   |
| `reconnecting`                 | Remote Control reconnecting | warning |
| `sessionActive \|\| connected` | Remote Control active       | success |
| 其它                           | Remote Control connecting…  | warning |

传输关闭码处理（REPL）：

| code                   | 含义                 | 处理                               |
| ---------------------- | -------------------- | ---------------------------------- |
| `1000`                 | 正常关闭             | teardown                           |
| `4001` / `4003`        | 鉴权/权限类          | 重连（可能触发 doReconnect）       |
| `1002` / `1006`        | 协议错误/异常断开    | 重连（bps 统计）                   |
| `4090`                 | epoch 被取代（409）  | 关闭资源 → 唤醒 poll 循环取新 work |
| `4091`                 | v2 `initialize` 失败 | `onClose(4091)` → poll 重试        |
| `4092`                 | SSE 重连预算耗尽     | 停止心跳 → 关闭                    |
| HTTP `401`（env-less） | JWT 失活             | `recoverFromAuthFailure`           |

worker 状态机（仅 v2）：`running` ↔ `requires_action` → `idle`。`requires_action` 表示有权限提示待处理，claude.ai 展示“等待输入”。

---

## 8. 可靠性与重连

### 8.1 退避参数

`bridgeMain.DEFAULT_BACKOFF`：

| 类别       | 初始   | 上限     | 放弃     |
| ---------- | ------ | -------- | -------- |
| connection | 2000ms | 120000ms | 600000ms |
| general    | 500ms  | 30000ms  | 600000ms |

- 分类：连接错误（`ECONNREFUSED/ECONNRESET/ETIMEDOUT/ENETUNREACH/EHOSTUNREACH`）与 HTTP 5xx（`ERR_BAD_RESPONSE`）共用 connection 预算；其余非致命错误走 general 预算。两类混切时重置另一类的计时与退避。
- 抖动：±25%（`addJitter`，下限 0）。
- 睡眠/唤醒检测：距上次轮询错误超过 `connCapMs * 2` 视为系统休眠，同时清零两类预算。
- 挂起检测：单次 sleep 超时 >60s 视为挂起。
- 退避 sleep 前，若心跳开启且存在活跃会话，先 `heartbeatActiveWorkItems()`，避免 /poll 故障期间 300s lease TTL 过期（心跳循环退出的场景同样处理）。

env-less `withRetry`（`DEFAULT_ENV_LESS_BRIDGE_CONFIG`）：

| 参数                          | 默认          |
| ----------------------------- | ------------- |
| `init_retry_max_attempts`     | 3             |
| `init_retry_base_delay_ms`    | 500           |
| `init_retry_jitter_fraction`  | 0.25          |
| `init_retry_max_delay_ms`     | 4000          |
| `http_timeout_ms`             | 10000         |
| `uuid_dedup_buffer_size`      | 2000          |
| `heartbeat_interval_ms`       | 20000（±10%） |
| `token_refresh_buffer_ms`     | 300000        |
| `teardown_archive_timeout_ms` | 1500          |
| `connect_timeout_ms`          | 15000         |

Zod 校验采用**整体拒绝**策略：任一字段越界即回退默认，避免“部分信任”。

### 8.2 轮询与心跳

`DEFAULT_POLL_CONFIG`：

| 字段                                  | 默认      | 说明                                                    |
| ------------------------------------- | --------- | ------------------------------------------------------- |
| `poll_interval_ms_not_at_capacity`    | 2000      | 寻找 work，决定“connecting…”延迟                        |
| `poll_interval_ms_at_capacity`        | 600000    | 服务端 Redis TTL 4h，10 分钟留 24× 余量                 |
| `non_exclusive_heartbeat_interval_ms` | 0（禁用） | 与 at-capacity poll 可并存                              |
| `multisession_*`                      | 同单会话  | 由 `tengu_bridge_poll_interval_config` 统一下发         |
| `reclaim_older_than_ms`               | 5000      | 与服务端 `DEFAULT_RECLAIM_OLDER_THAN_MS` 对齐           |
| `session_keepalive_interval_v2_ms`    | 120000    | 向 session-ingress 推 `{type:'keep_alive'}`，防代理回收 |

约束：`0` 或 `≥100` 的二值语义；对象级 refine 要求“至少一种 at-capacity 存活机制”（heartbeat 或 poll），否则会以 HTTP RTT 速度紧循环。`reclaim_older_than_ms` 是 ack 延迟的硬上限：5s 内未 ack 的 work 会被服务端回收重投。

### 8.3 恢复策略层次

| 层          | 触发                               | 动作                                                                              |
| ----------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| 传输内      | WS/SSE 瞬时失败                    | HybridTransport 内部重连 10 分钟；SSE 自带重连预算                                |
| 传输替换    | token 轮换 / epoch bump / 鉴权失败 | 重建 transport，携带 seq 高水位                                                   |
| 会话级      | environment 失联                   | 原地 reconnect → 归档重建（≤3 次）                                                |
| 进程级      | 进程崩溃                           | `bridge-pointer.json`（4h TTL，每小时刷新）                                       |
| 跨 worktree | `--continue`                       | `readBridgePointerAcrossWorktrees`，git worktree 扇出，上限 50，取 `ageMs` 最小者 |

---

## 9. 并发、顺序与幂等

| 机制                                   | 文件                  | 作用                                                                     |
| -------------------------------------- | --------------------- | ------------------------------------------------------------------------ |
| `BoundedUUIDSet`                       | `bridgeMessaging.ts`  | 环形集合：出站 echo 去重 + 入站重投去重                                  |
| `FlushGate<T>`                         | `flushGate.ts`        | 初始历史刷写期间排队新写入；`start/enqueue/end/drop/deactivate`          |
| `v2Generation`                         | `replBridge.ts`       | 握手代际；过期 transport 的回调被丢弃                                    |
| `authRecoveryInFlight`                 | `remoteBridgeCore.ts` | 防止并发 `/bridge` 重复 bump epoch                                       |
| `createCapacityWake`                   | `capacityWake.ts`     | 合并“关闭信号 + 容量释放信号”，避免 at-capacity 长睡阻塞新 work          |
| token 刷新 generation                  | `jwtUtils.ts`         | 每会话代际计数，旧刷新任务不得覆盖新 token                               |
| `sameSessionId`                        | `workSecret.ts`       | 会话归属判定                                                             |
| `toCompatSessionId`/`toInfraSessionId` | `sessionIdCompat.ts`  | 调用点“戏服”适配                                                         |
| `completedWorkIds`                     | `bridgeMain.ts`       | 跳过服务端陈旧重投                                                       |
| `previouslyFlushedUUIDs`               | `initReplBridge.ts`   | v1 跨会话历史去重（v1 新会话创建时 `clear()`；v2 因必是新 session 不传） |
| `genSeq` / `lastBridgeSessionId`       | `initReplBridge.ts`   | 标题生成乱序保护                                                         |
| `safeSpawn`                            | `bridgeMain.ts`       | spawn 失败不污染状态                                                     |
| `stopWorkWithRetry`                    | `bridgeMain.ts`       | 3 次，1s/2s/4s                                                           |

`FlushGate` 生命周期语义：

```
start()       → enqueue() 返回 true，写入排队
end()         → 返回排队项交由调用方发送
drop()        → 永久关闭时丢弃
deactivate()  → 传输替换时清 active 但保留队列（新传输会 drain）
```

---

## 10. 消息通路

### 10.1 出站（本机 → 远端）

查询循环产出 SDK 消息 → `transport.write/writeBatch`：

- v1：HybridTransport（WS 读 + HTTP POST 写）。
- v2：`CCRClient.writeEvent` → `SerialBatchEventUploader`（maxBatchSize=100），顺序由串行 enqueue 保证。

消息过滤与去重：

- `isEligibleBridgeMessage`：只放行 `user`、`assistant` 与非虚拟的 `system+subtype==='local_command'`；虚拟消息（REPL 内层调用）与其它类型（`tool_result`、`progress` 等）属于内部噪声，不转发。
- 三层去重：`initialMessageUUIDs`（建会话时随事件发送的历史）、`recentPostedUUIDs`（`BoundedUUIDSet(2000)` 环形近端集合）、hook 侧 `lastWrittenIndexRef` 索引游标；叠加后既防历史重放也防实时回显。
- 压缩（compaction）后若 `lastWrittenIndexRef > messages.length` 会 clamp，否则新消息永远不再转发（`useReplBridge.tsx`）。
- `system/init` 出站前固定 `tools: []`、`mcpClients: []`、`plugins: []`，只带经 `isBridgeSafeCommand` 过滤的 `commands`——防止泄漏本机 MCP 集成与插件路径（含用户名、目录结构）到远端持久化存储（v2 会写入 Spanner）。
- v2 中批内含 `user` 消息时主动 `reportState('running')`。

### 10.2 入站（远端 → 本机）

```
transport.onData(data)
 → handleIngressMessage:
      control_response  → onPermissionResponse()
      control_request   → handleServerControlRequest()
      user message only → 入队
      echo UUID 去重 / 入站重投去重
      webhook <github-webhook-activity> 保留标签但脱敏
```

### 10.3 服务器控制请求（`bridgeMessaging.ts`）

| subtype                   | 语义     | outboundOnly |
| ------------------------- | -------- | ------------ |
| `initialize`              | 握手     | 允许         |
| `set_model`               | 切换模型 | 拒绝         |
| `set_max_thinking_tokens` | 思考预算 | 拒绝         |
| `set_permission_mode`     | 权限模式 | 拒绝         |
| `file_suggestions`        | `@` 补全 | 拒绝         |
| `interrupt`               | 中断     | 拒绝         |

`outboundOnly`（mirror 模式）下除 `initialize` 外**一律回 error**（包括只读的 `file_suggestions`），只保留事件外发；`initialize` 必须回 success，否则服务端会关闭连接。

服务端发起的 `control_request` 必须在 ~10–14s 内应答，否则连接被服务端关闭；`initialize` 在 `outboundOnly` 下仍须回 success（否则服务端会杀连接），其余可变操作回 error。

### 10.4 附件 / 图片 / Webhook

- **附件**：`file_attachments: [{file_uuid, file_name}]` → `GET /api/oauth/files/{uuid}/content` → `~/.claude/uploads/{sessionId}/{uuid8}-{safeName}` → 以 `@"绝对路径"` 前缀拼到**最后一个 text block**（`processUserInputBase` 只读最后一个 block）。全流程 best-effort，单项失败只丢失该 @path。
- **图片**：兼容 iOS/Web 的 `mediaType`（camelCase）→ `media_type`（snake_case），缺失时按 base64 魔数探测；避免“media_type: Field required”污染整个会话。
- **Webhook**：先脱敏再截断（100KB），保留 `<github-webhook-activity>` 标签供 UI 路由。

### 10.5 权限与 Plan 模式

- 子进程 `can_use_tool` 控制请求 → `sendRequest` 到 Web → 用户决定 → `control_response` 回传。
- v1 API 另走 `POST /v1/sessions/{id}/events` 下发 `control_response`。
- v2 同时 `reportState('requires_action')`。
- `augmentBridgePermissionInput` 仅对 `ExitPlanMode` 附加 plan 文本用于**展示**；真实权限解析仍用原 input，避免把 `input.plan` 当作“用户编辑”。
- **三方竞速**：同一权限请求同时投给本地 UI、hooks、分类器与远端；任一先 `claim()` 即胜出（原子 check-and-mark），其余结果被丢弃。远端 `allow` 会持久化 `updatedPermissions`，远端 `deny` 走 `cancelAndAbort`；本地先解决时调用 `cancelRequest` 收起网页弹窗。
- **无客户端超时**：服务端只对“服务器发起的 control_request”计时，权限提示本身可以一直挂着等待某一方胜出（用户离开会话是唯一的自然终止）。

### 10.6 标题

优先级：`initialName`（`/remote-control <name>`）→ `/rename`（sessionStorage）→ 最后一条“有意义”的用户消息 → `remote-control-${slug}`。

- 首次用户消息（count 1）：先用 `deriveTitle`（50 字符占位），再异步 Haiku `generateSessionTitle`（15s 超时）升级。
- 第三次用户消息（count 3）：基于完整对话重新生成。
- 守卫：`genSeq`（防止 count-1 晚到覆盖 count-3）、`lastBridgeSessionId`（env-lost 换会话）、实时复查 `/rename`。
- `bridgeMain` 用 `deriveSessionTitle`（80 字符）从子进程首条用户消息派生。

---

## 11. 多会话与工作目录

| Spawn mode       | 行为                                   |
| ---------------- | -------------------------------------- |
| `single-session` | cwd 中一个会话；会话结束即关闭 bridge  |
| `same-dir`       | 常驻；所有会话共享 cwd（可能互相踩踏） |
| `worktree`       | 常驻；每个会话独立 git worktree        |

- 默认容量 32（`--capacity`）。
- 首次运行弹窗选择模式并持久化到项目配置；运行期 `w` 切换。
- 数量指示：`n/m sessions` + spawn-mode 提示。
- env-less 路径不支持 `perpetual`（env 耦合），会自动回退 v1，以免 KAIROS 用户丢失跨重启连续性。

**模式优先级**（`bridgeMain.ts:1940-1964`）：

```
resume(--continue / --session-id) > --spawn > 保存的 ProjectConfig.remoteControlSpawnMode
                                  > 门控默认（on → same-dir，off → single-session）
```

- `resume` 恒为 `single-session`（恢复目标就是某个特定会话及其原目录）。
- `--spawn` 只影响本次运行，不持久化。
- 门控 `tengu_ccr_bridge_multi_session` 关闭时，显式传入 `--spawn` / `--capacity` / `--create-session-in-dir` 会直接报错退出。

**容量与预建**：

```ts
maxSessions = spawnMode === 'single-session' ? 1 : (parsedCapacity ?? 32)
preCreateSession = parsedCreateSessionInDir ?? true
```

预建会话会**占用唯一的 single-session 槽位**：预建成功时真正派发就已满载；预建失败或环境不匹配时则可能出现“网页用了另一个 session”的现象。`--no-create-session-in-dir` 可关闭预建（纯按需、每个会话都隔离）。

**worktree 与运行时切换**：worktree 只为**非初始会话**创建（初始会话始终在启动目录）；`w` 键仅在“非 single-session 且 worktree 可用”时开放。

---

## 12. 崩溃恢复

`bridge-pointer.json`（zod 校验）：

```jsonc
{ "sessionId": "...", "environmentId": "...", "source": "standalone" | "repl" }
```

| 属性 | 值                                                               |
| ---- | ---------------------------------------------------------------- |
| 位置 | 项目配置目录（项目路径 sanitize）                                |
| TTL  | 4h（mtime），与服务端 Redis `BRIDGE_LAST_POLL_TTL` 对齐          |
| 刷新 | 每小时                                                           |
| 读取 | 先本地缓存；`--continue` 时 git worktree 扇出（上限 50），取最新 |
| 清理 | 过期/非法自动清除；正常 teardown 显式 `clearBridgePointer`       |

恢复流程：

- `--session-id`（KAIROS gated）：`getBridgeSession` → `reuseEnvironmentId` 重注册 → `reconnectSession`（先 `session_*`，失败再 `cse_*`）。
- `--continue`：读 pointer → 跨 worktree 找最新 → 复用。

**可恢复退出**（`feature('KAIROS')` gated）：single-session 且已有 `initialSessionId`、且退出**非致命**时，shutdown 跳过 archive 与 deregister，打印 `Resume this session by running \`claude remote-control --continue\``，环境靠服务端 4h TTL 自然回收。致命退出（环境过期、认证失败、连续放弃）不打印该提示，以免给出无法兑现的命令。

---

## 13. 配置与特性开关

### 13.1 编译期 feature（`bun:bundle`）

| Feature            | 作用                                                         |
| ------------------ | ------------------------------------------------------------ |
| `BRIDGE_MODE`      | 整个 bridge 在外部构建中可被 tree-shake                      |
| `KAIROS`           | assistant 模式、`--session-id` 恢复、perpetual               |
| `CCR_AUTO_CONNECT` | 默认自动连接（`tengu_cobalt_harbor`）                        |
| `CCR_MIRROR`       | mirror 模式（`tengu_ccr_mirror` / `CLAUDE_CODE_CCR_MIRROR`） |

### 13.2 GrowthBook

| Key                                        | 用途                                            |
| ------------------------------------------ | ----------------------------------------------- |
| `tengu_ccr_bridge`                         | bridge 总开关（blocking 读取）                  |
| `tengu_ccr_bridge_multi_session`           | 多会话 spawn                                    |
| `tengu_bridge_repl_v2`                     | env-less v2 路径                                |
| `tengu_bridge_repl_v2_cse_shim_enabled`    | `cse_→session_` 重标签 kill switch（默认 true） |
| `tengu_bridge_repl_v2_config`              | v2 参数（见 8.1）                               |
| `tengu_bridge_min_version`                 | v1 最低版本                                     |
| `tengu_bridge_initial_history_cap`         | 初始历史条数（默认 200）                        |
| `tengu_bridge_poll_interval_config`        | 轮询参数（5 分钟刷新）                          |
| `tengu_sessions_elevated_auth_enforcement` | 受信设备强制                                    |
| `tengu_cobalt_harbor`                      | 自动连接默认值                                  |
| `tengu_ccr_mirror`                         | mirror 灰度                                     |

### 13.3 环境变量

| 变量                                                   | 作用                                    |
| ------------------------------------------------------ | --------------------------------------- |
| `CLAUDE_BRIDGE_OAUTH_TOKEN` / `CLAUDE_BRIDGE_BASE_URL` | ant-only 本地开发覆盖（自托管判定依据） |
| `CLAUDE_BRIDGE_SESSION_INGRESS_URL`                    | ant-only ingress 覆盖                   |
| `CLAUDE_CODE_USE_CCR_V2`                               | 让 v1 路径使用 CCR v2 传输              |
| `CLAUDE_CODE_WORKER_EPOCH`                             | 子进程携带 epoch                        |
| `CLAUDE_CODE_ENVIRONMENT_KIND=bridge`                  | 子进程标记                              |
| `CLAUDE_CODE_SESSION_ACCESS_TOKEN`                     | v1 子进程 ingress token                 |
| `CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2=1`            | 子进程写路径                            |
| `CLAUDE_CODE_CCR_MIRROR`                               | 本地打开 mirror                         |

### 13.4 用户配置

`remoteControlAtStartup`、`bridgeOauthDeadExpiresAt`、`bridgeOauthDeadFailCount`。

自托管（`isSelfHostedBridge()`，即设置了 `CLAUDE_BRIDGE_BASE_URL`）**绕过**所有 GrowthBook 与订阅检查，org UUID 固定为 `self-hosted`。

---

## 14. 可观测性

- **debug 日志**：`logForDebugging`；`debugBody` 负责 JSON 脱敏与 2000 字符截断；`describeAxiosError` 附带服务端 `message`/`error.message`；`extractHttpStatus` 区分 HTTP 与网络错误。
- **遥测**：`logBridgeSkip(reason)` → `tengu_bridge_repl_skipped`；`tengu_bridge_repl_connect_timeout`（约 1% “started 后静默”会话的唯一信号）；archive 状态；`ws_closed` 关闭码。
- **运维调试**：`/bridge-kick`（ant-only）可注入 fatal/transient 故障（`pollForWork`/`registerBridgeEnvironment`/`reconnectSession`/`heartbeatWork`）、触发 `fireClose`、`forceReconnect`、`wakePollLoop`；`registerBridgeDebugHandle` 暴露 env/session ID 便于 grep。
- **UI**：150ms shimmer spinner，`space` 切二维码，`w` 切 spawn mode，OSC-8 超链接；多会话 bullet 列表含 `n/m` 与每条会话活动摘要（`tool_start` 30s 过期）。

---

## 15. 测试

`src/bridge/__tests__/`：

| 文件                       | 覆盖                                                       |
| -------------------------- | ---------------------------------------------------------- |
| `workSecret.test.ts`       | `buildSdkUrl` 的 ws/wss、localhost `/v2/` 拆分、尾斜杠处理 |
| `webhookSanitizer.test.ts` | 各类凭据脱敏、控制字符、截断、块数组不变性                 |
| `fileSuggestions.test.ts`  | 顺序保留、去重、上限                                       |
| `bridgePlanInput.test.ts`  | 仅 ExitPlanMode、空 plan 不注入、不可变                    |

注意：`bun test` 默认排除 `packages/rcs`；bridge 本身覆盖稀疏，主要靠这些纯函数单测。

---

## 16. 设计权衡、风险与演进

### 已体现的权衡

1. **双标签 ID**：为兼容 compat 层与前端路由，客户端承担 retag 复杂度。一旦服务端按 `environment_kind` 重打标签、前端直接接受 `cse_`，即可翻转 `tengu_bridge_repl_v2_cse_shim_enabled` 关闭 shim。
2. **v2 每次 `/bridge` 都 bump epoch**：换取“凭据获取即注册”的原子性，代价是任何取凭据都必须整条传输重建，且多实例并发会互相踢下线 → 用 `authRecoveryInFlight` 串行化。
3. **v1/v2 双实现 + 多 gate**：渐进迁移，但形成 `4 条路径 × N 个 gate` 的组合；`initReplBridge` 的 gate 顺序被刻意固定（OAuth 在 policy 之前，避免 console 用户看到误导性的 policy 错误）。
4. **poll 作为“存活信号”而非恢复路径**：at-capacity 10 分钟轮询，传输内部自动重连 10 分钟；恢复主要靠 transport，poll 兜底永久关闭。
5. **v2 立即回执 `processed`**：在 SSE 收到即 ACK `received` + `processed`，牺牲“崩溃丢一条 prompt”的可能，换取避免每次 daemon 重启把历史 prompt 重放成 N 条 system-reminder（观测到 21→24→25 的幻影提示）。
6. **1.5s archive 超时**：`gracefulShutdown` 只有 2s 清理预算，且在 1.5s 内还要并行 stopWork、串行 deregister；更高超时只是“骗 axios”。
7. **依赖注入而非静态 import**：`onAuth401`、`getPollIntervalConfig`、`setCseShimGate` 等避免把 `config.ts → commands.ts → React 组件树` 拉进 Agent SDK bundle。
8. **自托管旁路**：`isSelfHostedBridge()` 直接放行，便于 RCS；但也意味着自托管环境不享受 GrowthBook 的灰度保护，需要自行保证版本兼容。

### 已知风险 / 改进方向

| 风险                     | 说明 / 建议                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| 身份 tag 双轨            | 依赖服务端 compat 行为；任何服务端 refactor 都可能让历史会话“找不到”。shim 的 kill switch 是唯一缓冲。 |
| epoch 语义脆弱           | 多进程/多实例同时 `POST /bridge` 会互踢；当前仅用进程内闩锁缓解。                                      |
| 路径组合爆炸             | v1/v2 × spawn/same-dir/worktree × perpetual/outboundOnly × REPL/SDK/daemon，测试矩阵大。               |
| 幂等边界                 | `archiveSession` 对 409 幂等，但 `stopWorkWithRetry` 的重复调用依赖服务端容忍。                        |
| 长连接静默失败           | `connect_timeout_ms` 只覆盖“既不 onConnect 也不 onClose”的 1% 场景；更广的静默仍依赖 poll 兜底。       |
| `peerSessions.ts` 仍是桩 | `postInterClaudeMessage` 返回 `{ok:false}`，跨会话消息能力尚未实现。                                   |
| 标题生成依赖 Haiku       | 远端网络/额度异常时保留占位标题，不影响主流程。                                                        |
| 初始历史上限             | 默认 200；`previouslyFlushedUUIDs` 只在 v1 生效，v2 每会话全新。                                       |

### 已知限制（源码可见）

1. **REPL 只有一个会话**：`isAtCapacity = transport !== null`；满载时不 ack、不 spawn，第二路网页会话需要另一台机器或另一个环境。
2. **预建会话占用唯一槽位**：single-session 且默认预建时，预建成功即用满并发；预建失败则网页可能改投别处。
3. **archive 是终态**：multi-session 下会话结束**不 archive**，结束的会话保持可恢复；archive 只在显式操作 / teardown 时发生。
4. **epoch 强制全量重建**：v2 每次 `/bridge` 都 bump epoch，无法只换 JWT；旧连接约 20s 内收到 409。
5. **权限提示无客户端超时**：一直挂起，直到某一方胜出或用户离开。
6. **single-session 与循环耦合**：会话结束即销毁环境；multi-session 才“会话结束、bridge 继续”。
7. **worktree 只对非初始会话创建**：初始会话始终在启动目录。
8. **pointer 是尽力而为**：写失败只 warning；崩溃恢复依赖 mtime 在 4h 内有效。

### 演进观察点

- `use_code_sessions`（work secret）与 `tengu_bridge_repl_v2` 是两条独立的迁移轴：前者是“传输/会话创建方式”，后者是“是否去掉 environment 层”。文档中所有 “env-less” 均指后者。
- 一旦 `/worker/*` 服务端完全接受 `cse_` 与所有客户端，可删除 `session_*` 双轨。
- perpetual（跨重启会话连续性）目前只在 v1 可用；v2 若要支持，需要把 bridge-pointer 的语义从“environment 复用”改为“code-session 复用 + epoch 重建”。

---

### 附：两条主链路时序

**v2 env-less**

```
CLI ──POST /v1/code/sessions {title,bridge:{}}──► Server
    ◄────────────── {session:{id:"cse_..."}}
CLI ──POST /v1/code/sessions/cse_x/bridge───────► Server
    ◄──── {worker_jwt, api_base_url, expires_in, worker_epoch}
CLI ──GET  {api}/v1/code/sessions/cse_x/worker/events/stream──► (SSE)
CLI ──POST {api}/v1/code/sessions/cse_x/worker/events─────────► (出站)
CLI ──POST .../worker/events/{id}/delivery received|processed─►
CLI ──PUT  .../worker/state running|requires_action|idle──────►
CLI ──(expires_in-300s)──► 重取 /bridge（epoch++）→ 重建 transport
CLI ──POST /v1/sessions/session_x/archive─────────────────────► (teardown)
```

**v1 REPL**

```
CLI ──POST /v1/environments/bridge──────────► env_id, env_secret
CLI ──POST /v1/sessions (events:[])─────────► session_id
CLI ──GET  /v1/environments/{env}/work/poll─► {...work, secret}
CLI ──POST .../work/{id}/ack
CLI ──decodeWorkSecret → session_ingress_token
CLI ──WS   /v1/session_ingress/ws/{session}──► 读
CLI ──POST .../sessions/{session}/events────► 写
CLI ──POST .../work/{id}/heartbeat──────────► 续租
CLI ──POST .../work/{id}/stop + archive─────► teardown
CLI ──DELETE /v1/environments/bridge/{env}──►
```

---

## 17. 补充不变量

- **序列号种子**：SSE 序列号只在“复用已有会话”时增量续接；全新会话从 0 开始，否则会跳过历史。传输替换时用 `getLastSequenceNum()` 作为新 `initialSequenceNum`。
- **`v2Generation` 判定胜者**：两个握手并发时靠 generation 计数决定谁赢，避免双双看到 transport 为空后都去解析。
- **teardown 顺序不可调换**：`write()` 只是入队、`close()` 会打断排空，因此必须 `result → archive → close`。
- **入站去重是防御性兜底**：SSE 序列号续接是主修复，`recentInboundUUIDs` 只覆盖协商失败的边角（服务端忽略 `from_sequence_num`、传输在收到任何帧前死亡等）。
- **v1 上传失败上限**：`HybridTransport` 配 `maxConsecutiveFailures: 50`；连续失败达到阈值后整批丢弃并计入 `droppedBatchCount`（同时释放回压），不再无限重试。
- **`system/init` 脱敏**：出站固定 `tools: [] / mcpClients: [] / plugins: []`，只带 bridge-safe `commands`（v2 会持久化到 Spanner）。
- **Headless 变体**：`runBridgeHeadless` 复用同一 `runBridgeLoop`，但没有 TUI / stdin / `process.exit`；不可重试错误抛 `BridgeHeadlessPermanentError` 交由 daemon 监督进程。
- **shutdown 预算**：单个子进程 SIGTERM→SIGKILL 宽限默认 30s（`shutdownGraceMs`）；v2 teardown 的 archive 上限 1.5s，v1 archive 为 best-effort。
- **`w` 切换条件**：仅“非 single-session 且 worktree 可用”时显示并生效。
