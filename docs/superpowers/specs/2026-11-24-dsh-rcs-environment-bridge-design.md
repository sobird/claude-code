# dsh-rcs-plugin：环境 worker 模式与手动同步设计

- 日期：2026-11-24
- 状态：待评审
- 涉及包：`packages/dsh-rcs-plugin`、`packages/dsh-bridge`（RCS 服务端不改）

## 1. 背景与目标

`dsh-bridge`（独立进程）与 `dsh-rcs-plugin`（dsh 进程内插件）目前都只支持**一条固定的
RCS 会话**：插件启动时创建或复用自己的 `cse_` 会话，然后把这条会话桥到 dsh。

本次要把模型扩展成「RCS 是控制面，dsh 是本机执行侧」：

- **B（主干）**：在 RCS Web 里新建会话并选中本机环境，dsh 自动领取并开始执行。
- **C（手动同步）**：在 dsh Web UI 里对一条已有本地会话执行命令，把它同步到 RCS。

目标是复用现有每会话桥（`InProcessBridge`、事件翻译、审批/提问、流式、interrupt），
只补「怎么找到要桥哪条会话」这一层。

### 非目标

- 自动镜像（dsh 新建即同步到 RCS）——见 §9。
- 历史消息回填。
- 多机共享 `$DSH_HOME` 的去重/协调。
- 修改 RCS 服务端或数据库。

## 2. 已核实的事实

以下均已对照代码确认，实施时以这些接口为准。

**环境注册与派发（RCS）**

- `POST /v1/environments/bridge`（用户 API key 鉴权）接受
  `environment_id?`、`machine_name`、`directory`、`branch`、`git_repo_url`、
  `max_sessions`、`bridge_id`、`capabilities`、`worker_type`（顶层或 `metadata.worker_type`）；
  返回 `{environment_id, environment_secret, status}`。
  见 `packages/rcs/src/routes/v1/environments.ts:29`、
  `packages/rcs/src/services/environment.ts:30`。
- `environment_secret` 是签发的环境 token，每次注册都会重新签发（有 TTL）。
  客户端只需持久化 `environment_id`，重启时带旧 id 重注册。
- `GET /v1/environments/:id/work/poll`（环境 token）返回
  `{id, type:'work', environment_id, state, data:{type:'session', id:'cse_…'}, secret, created_at}`，
  无工作返回 204。`timeout` 查询参数以**秒**为单位；`reclaim_older_than_ms` 默认 5000，
  过期未 ack 的工作会被重投递。见 `packages/rcs/src/routes/v1/environments.work.ts:34`、
  `packages/rcs/src/services/work-dispatch.ts:25`。
- `ack` 可用 work secret 里的 worker token 或环境 token；`stop` 只认环境 token；
  `heartbeat` 两者皆可。见同文件 `:53`、`:61`、`:69`。
- work secret 是 base64url 的 JSON：`{version:1, session_ingress_token, api_base_url,
sources:[], auth:[], use_code_sessions:false}`。`session_ingress_token` 就是该
  `cse_` 会话的 worker JWT，可直接用于 worker 事件/状态/心跳/SSE。
  见 `packages/rcs/src/services/work-dispatch.ts:42`。
- Web 新建会话时 `environment_id` 会触发 `createWorkItem`（`routes/web/sessions.ts`），
  `NewSessionDialog` 已把所有环境列进下拉框、不按 `worker_type` 过滤
  （`packages/rcs/src/components/shell/NewSessionDialog.tsx:56`）。**RCS UI 无需改动。**
- `POST /v1/code/sessions` 接受 `environment_id`，但**不会**入队工作；只做归属校验
  （`packages/rcs/src/routes/v2/code-sessions.ts:19`）。
- `POST /v1/environments/:id/bridge/reconnect`（用户 key）会把该环境下所有 `idle`
  会话重新入队（`services/work-dispatch.ts:159`）。
- `GET /v1/sessions/:id`（用户 key）可读会话元数据（标题等）
  （`packages/rcs/src/routes/v1/sessions.ts:91`）。
- `session_workers.external_metadata` 是 JSONB，`PUT /v1/code/sessions/:id/worker`
  写入时**浅合并**，可在 UI 观察（`db/repositories/session-workers.ts:31`、
  `routes/v2/worker.ts:68`）。但它**不可检索**，不能当映射索引。

**dsh 侧**

- `InProcessBridge` 已经是自包含的单会话桥：按 sessionId 过滤事件、懒创建 agent、
  30s 心跳、SSE 重连、流式合批、审批/提问、interrupt。见
  `packages/dsh-rcs-plugin/src/bridge.ts`。
- agent 懒创建时，有落盘记录用 `agents.resume({resumeSessionId})`，否则
  `agents.create({sessionId, meta:{cwd}, agentOptions})`；`cse_` 只是编译期 brand，
  运行时可作任意字符串 id。
- 命令注册：`commands` 服务（`CommandRuntime`）提供 `register({name, description,
handler})`，返回 disposer；插件的普通上下文注册的是全局命令，handler 能拿到触发它的
  agent。见 deepseek-harness `packages/interaction/commands/src/index.ts:263`。
- `session/created` 事件会带 session 对象（`packages/core/session/src/index.ts:62`）。
- dsh 会话头不可变，Web UI 创建的 id 形如 `session-<uuid>`，无法改写成 `cse_`。

## 3. 身份模型

- **RCS 是 id 权威**：会话 id 一律由 RCS 签发（`cse_<uuid>`）。
- **B 路径无映射**：RCS 派发的会话 id 直接作为 dsh 会话 id，两边同 id。
- **C 路径必须映射**：dsh 的 `session-<uuid>` 无法改名，需要本地 sidecar 记录
  `dshId ↔ rcsId`。
- **桥持有两个 id**：`rcsSessionId` 用于 worker 协议，`agentSessionId` 用于 dsh 会话。
  B 路径相同，C 路径不同；所有事件过滤与 agent 操作都按 `agentSessionId`。
- 不给 dsh 会话加 `dsh_` 前缀：前缀是端点约定（RCS 的 `cse_`/`session_` 是同一 id 的
  两种外形），不是来源标记，加前缀只会制造第二套 id 空间。

## 4. 架构

```
单会话模式（现状，sdk profile）
  apply() ── create/reuse cse_ ── openWorker ── InProcessBridge

环境 worker 模式（新增，web profile）
  apply() ── registerEnvironment ── poll loop ── work(cse_)
            └─ supervisor（sessionId → bridge，maxSessions 上限）
                  ├─ cse_A → InProcessBridge（agent id = cse_A）
                  └─ cse_B → InProcessBridge（agent id = cse_B）

手动同步（C）
  /rcs-sync ── 读当前 agent id ── sidecar 查重 ── POST /v1/code/sessions(env)
            ── 写 sidecar ── openWorker ── supervisor.attach(rcsId, dshId)
```

两种模式共用 `InProcessBridge`，区别在两点：

- **凭据来源**：单会话模式用 `POST /v1/code/sessions/:id/bridge`（用户 key）换
  `worker_jwt`；环境模式用 work secret 里的 `session_ingress_token` + `api_base_url`。
- **id 绑定**：桥必须同时持有 `rcsSessionId`（上报事件、写状态、SSE、心跳）和
  `agentSessionId`（事件过滤、`agents.get/create/resume`、工作区挂载）。B 路径两者
  相同；C 路径分别是 `cse_…` 与 `session-…`。这是对现有 `InProcessBridge` 的唯一
  结构性改造（目前两者共用一个 `sessionId`）。

## 5. 关键决策

| 决策                        | 选择                                            | 理由                                                            |
| --------------------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| 默认模式                    | `single`                                        | 不改变 sdk profile 与既有部署；web profile 显式配 `environment` |
| 凭据刷新                    | 401 时用用户 key 调 `openWorker` 换票           | work 已 ack 不会重投；bridge 握手始终可用且幂等                 |
| 环境状态持久化              | 只存 `environment_id`                           | secret 每次注册重签，存了反而多一份敏感数据                     |
| 工作重投递                  | 同 rcsSessionId 已有桥则复用                    | ack 丢失/重启后重复派发必须幂等                                 |
| 重启恢复                    | 注册后调 `/bridge/reconnect` 重排 idle 会话     | poll 只重投未 ack 的，已 ack 的不会回来                         |
| 收 work 先查 sidecar 反查表 | 命中则 `agentSessionId` 用映射里的 dsh id       | reconnect 会把 C 同步的会话重新入队，否则会分叉出新的空 agent   |
| `maxSessions` 语义          | 存活桥上限（默认 4），达上限暂停 poll           | idle 会话必须保持桥接才能收后续消息；工作留在服务端不丢         |
| HTTP 错误                   | `RcsHttpError(status)` 类型化                   | 401 换票与 404 停桥需要区分状态码，不能只匹配错误消息           |
| C 的桥启动                  | 直接 `openWorker` 起桥，不走工作队列            | 建会话接口不入队；直接起桥最快且路径最短                        |
| A（自动镜像）               | 不做                                            | 见 §9                                                           |
| sidecar                     | `~/.dsh/rcs-bridge/sessions.json`，0600，原子写 | 简单、可人工修复；跨机协调不在本期                              |

## 6. 阶段 B：环境 worker 模式

### 6.1 配置

| 字段 / 环境变量                        | 默认     | 说明                                                           |
| -------------------------------------- | -------- | -------------------------------------------------------------- |
| `mode` / `RCS_BRIDGE_MODE`             | `single` | `single` 或 `environment`                                      |
| `environmentId` / `RCS_ENVIRONMENT_ID` | —        | 复用既有环境 id（可选）                                        |
| `maxSessions` / `RCS_MAX_SESSIONS`     | `4`      | 存活桥上限，同时作为注册时的 `max_sessions`；达上限时暂停 poll |

其余字段（`apiKey`、`rcsBaseUrl`、`workdir`、`provider`、`model`、`sessionTitle`、
`sessionId`）语义不变。`sessionId` 只在 `single` 模式下有意义。

`maxSessions` 还支持运行时修改（`/rcs-max-sessions <n>`，见 §7.4），不必重启 dsh。
服务端的 `max_sessions` 只用于 UI 展示容量，**不参与派发强制**，真正生效的是插件本地值。

### 6.2 环境客户端（`dsh-bridge`）

新增 `packages/dsh-bridge/src/environment.ts`，经 `core` 导出：

- `register(apiKey, {environmentId?, machineName, directory, maxSessions, workerType})`
- `poll(environmentId, envSecret, {timeoutSeconds, reclaimOlderThanMs, signal})`
- `ack(environmentId, workId, token)` / `heartbeat(...)` / `stop(...)` / `deregister(...)`
- `parseWorkSecret(secret)` → `{sessionIngressToken, apiBaseUrl}`
- `toWorkerSession(work)` → 现有 `WorkerSession` 形状，`expiresAt` 取保守值（如
  握手响应才有的 TTL 缺失时按 1 小时），401 后由 §5 的换票路径兜底。

`RcsClient` 行为不变，只做三处增量：把非 2xx 抛出的错误换成带 `status` 的
`RcsHttpError`（导出到 `core`）；`createSession(title, environmentId?)` 增加可选的环境
绑定（`POST /v1/code/sessions` 已接受 `environment_id`）；`setExternalMetadata(worker,
metadata)` 用于手动同步后写入 `{dsh_session_id}`。环境客户端复用同样的 `fetch` +
envelope 解析风格。

### 6.3 插件侧

- `src/environment.ts`：注册 → 落盘 `~/.dsh/rcs-bridge/environment.json`（只含
  `{version, environmentId}`）→ 启动时带旧 id 重注册（后端可能换新 id，以响应为准）→
  调 `/bridge/reconnect` → 启动 poll 循环（`AbortSignal`，`timeout` 用 20～30 秒，
  `reclaim_older_than_ms=5000`；204 视为正常）。
- `src/supervisor.ts`：
  - 表 `rcsSessionId → InProcessBridge`；`maxSessions` 计的是**存活桥**（idle 的桥也
    占位，因为它还要接收后续消息）。已达上限时暂停 poll，工作留在服务端，有空位再取。
  - 收 work → `ack` → `toWorkerSession` → 用 `work.data.id` 查 sidecar 反查表，命中
    则 `agentSessionId` 用映射里的 dsh id，否则两者相同 → 表中已有则复用，否则起桥 →
    `GET /v1/sessions/:id` 取标题用于 dsh 会话命名（失败则沿用默认标题）。
  - work `stop` / 会话 404 / 环境掉线：停对应桥并移出表，释放槽位。
  - `dispose`：停所有桥 → `deregister`。
  - `attach(rcsSessionId, agentSessionId)` 是 C 路径的入口：不受 `maxSessions` 限制，
    但超限时记一条警告（手动操作优先，避免用户以为同步失败）。
- `src/index.ts`：`mode=environment` 时走 supervisor，`single` 时保持现状；
  `inject` 仍是 `['agents', 'sessionQuery']`（环境模式不依赖 `sessionQuery`，但保留
  以便单会话模式复用）。
- **监听组织**：每会话桥继续各自注册 `session/event`/`agent/status`/
  `agent/assistant-stream`，并按 `agentSessionId`/`agent.id` 过滤（C 路径即 dsh id，
  不是 RCS id）；审批与提问监听用
  `prepend`，非本 agent 一律 `next()`。N 条桥 = N 组监听，行为与现在一致，不改
  waterfall 语义。

### 6.4 状态与生命周期

- 每会话状态（`idle`/`running`/`requires_action`）仍由各自的桥写入，互不影响。
- 环境 token 过期：poll 收到 401 → 用 `apiKey` 重注册（带旧 id）→ 换新 secret →
  继续；单次失败退避 1s。
- worker token 过期：桥内请求 401 → `openWorker(rcsSessionId)` 换票后重试一次；
  再失败记日志并降级（心跳继续，事件队列暂停重试）。
- RCS 侧会话被删除：worker 请求 404 → 停桥并移出表，不重试。
- 以上分支一律按 `RcsHttpError.status` 判断，不匹配错误文本。

## 7. 阶段 C：手动同步

### 7.1 命令

通过 `commands` 服务注册 `/rcs-sync`（服务不存在则跳过注册并记日志）：

1. 从 handler 取 `agent.id`（dsh 会话 id）。已是 `cse_` 前缀 → 报「已在 RCS」。
2. 查 sidecar；已有映射 → 报「已同步，会话 id 为 …」，不重复创建。
3. `createSession(title, environmentId)`，带已注册环境（若有）与标题（取 dsh 会话
   标题，缺失则用会话 id）。
4. 写 sidecar（原子写、0600）。
5. `openWorker(rcsId)` → `supervisor.attach(rcsId, agent.id)` 起桥；`agent.id` 与
   `rcsId` 不同，这是 C 路径与 B 路径的关键差别。
6. `PUT /worker` 写 `external_metadata: {dsh_session_id}` 便于在 RCS 侧观察。

### 7.2 sidecar

```json
{
  "version": 1,
  "sessions": {
    "session-6a5a21c2-…": { "rcsSessionId": "cse_…", "syncedAt": "2026-11-24T…" }
  }
}
```

- 双键写入（dshId → rcsId），反查在内存里建反向表。
- 文件损坏/无法解析：重命名为 `.bak` 并重建，记 stderr。
- 与 `environment.json` 同目录，均 0600；不写进程内之外的秘密。

### 7.3 明确限制

- **v1 不回填历史**：RCS 侧会话从同步之后的增量开始显示；命令输出和 README 明说。
- 同步后的 dsh 会话若在 RCS 被删除，桥在 404 时停止；sidecar 条目保留，重复同步会
  提示先清理（v1 不自动清理）。

### 7.4 `/rcs-max-sessions`

与 `/rcs-sync` 同一注册入口（`commands` 服务不存在则跳过并记日志）：

1. 参数必须是正整数；非法值回错误、不改动任何状态。
2. 更新内存中的上限。
3. 用旧 `environmentId` 重新注册，上报新的 `max_sessions`（重新签发 secret，但环境
   id 保持不变）；上报失败只记日志，不影响本地生效。
4. 调低到低于当前存活桥数时**不杀已有桥**，只暂停 poll；调高后立即恢复 poll。
5. 仅 `mode=environment` 有效；`single` 模式返回提示。

## 8. 测试

- `dsh-bridge`：环境客户端（注册载荷、poll 204、ack/heartbeat/stop、401、secret 解码、
  204/500 边界）；`FakeRcs` 增加环境与工作端点。
- `dsh-rcs-plugin`：
  - supervisor：work → ack → 起桥；重复 work 幂等；stop → 停桥；`maxSessions` 暂停
    poll；dispose 全停 + deregister；reconnect 流程。
  - 双 id：B 路径 `rcsSessionId === agentSessionId`，事件正常路由；C 路径事件按 dsh id
    过滤、上报用 RCS id；work 到达时 sidecar 反查命中则复用原 agent id。
  - 错误分支：`RcsHttpError(401)` 触发换票重试、`(404)` 停桥。
  - 配置：`mode` 分支、非法值报错。
  - `/rcs-max-sessions`：非法参数不改状态；调高恢复 poll；调低不杀存活桥；重注册
    上报新值；`single` 模式返回提示。
  - `/rcs-sync`：首次、重复、无 commands 服务、标题缺失。
  - sidecar：原子写、损坏重建、反查。
- 既有 25 个插件测试与 27 个桥测试保持绿。
- 真实 e2e（门控，不进 `bun test`）：临时环境注册 → RCS Web 建会话 → dsh 领到并完成
  一轮 → interrupt；以及 `/rcs-sync` 一轮。

## 9. 不在本期：自动镜像（A）

「dsh 新建会话自动出现在 RCS」不做，理由：

1. C 已覆盖主动同步场景；A 只省一次显式操作。
2. A 的真正成本是策略而非代码：哪些工作区、是否包括试验会话、多机如何去重。
   默认值猜错会造成噪音与隐私问题。
3. RCS 正走向 SaaS，自动上报本机全部会话的语义比显式选择更难解释。

保留挂载点：sidecar 已是双键结构，`session/created` 监听位置明确；将来若做，应作为
默认关闭的 `autoSync` 开关，且只覆盖显式注册的工作区。

## 10. 风险与开放问题

- **多机共用 `$DSH_HOME`**：sidecar 会互相覆盖；本期按单机假设，文档写明。
- **工作队列与手动桥并存**：C 起的桥不走队列，若同一会话后续被 reconnect 重排，
  supervisor 需按 sessionId 复用而不是再起一条。
- **`maxSessions` 与 RCS 展示**：注册时上报 `max_sessions`，RCS UI 用来显示容量；
  插件本地同样限制，两者必须一致。
- **worker_type 取值**：建议 `deepseek`（非 `claude_code`/`acp`），不触发 ACP 的
  单会话特判；需确认 RCS 侧没有其他按类型的过滤（已核实创建对话框不过滤）。
- **标题同步**：RCS 侧改标题后是否回写 dsh，本期不做（只读 RCS 标题用于初始命名）。

## 11. 验收标准

1. `mode=environment` 启动后，RCS 环境列表出现本机环境；Web 新建会话并选中它，dsh
   自动执行一轮，RCS 看到 assistant/工具/结果，状态从 `running` 回到 `idle`。
2. 重启 dsh：环境自动重注册，idle 会话被 reconnect 重排并恢复桥接；无重复桥。
3. 并发两条会话在 `maxSessions=2` 下互不串扰；超限时工作留在队列，不丢。
4. `/rcs-sync` 能把一条既有 dsh 会话同步到 RCS，重复执行幂等；历史不回填的提示可见。
5. 运行 `/rcs-max-sessions` 后无需重启：调高立即能领到新工作，调低不再领新工作且
   已有桥不受影响；RCS 环境列表的容量显示同步更新。
6. `bun run rcs:typecheck|rcs:lint|rcs:test` 不受影响；`dsh-bridge` 与
   `dsh-rcs-plugin` 的 test/typecheck/build 全绿；根 `fmt:check`/`lint` 干净。

## 12. 评审修订记录（2026-11-24，builder check）

子代理按「拿到文档就能动手」的标准提出 5 个会导致返工的问题，已并入上文：

1. **桥的 id 绑定**：C 路径 RCS id 与 dsh id 必然不同，桥改为
   `(rcsSessionId, agentSessionId)`，见 §3、§4、§6.3。
2. **`maxSessions` 语义**：计存活桥而非进行中的轮次；默认从 1 提到 4，见 §5、§6.1。
   （默认值是我的判断，可改。）
3. **重启后的 C 会话**：reconnect 会把 C 会话重新入队，收 work 时必须先查 sidecar
   反查表，否则分叉出新的空 agent，见 §5、§6.3。
4. **401/404 区分**：`RcsClient` 抛带 `status` 的 `RcsHttpError`，见 §6.2、§6.4。
5. **`createSession` 带环境**：增加可选 `environmentId` 参数，见 §6.2、§7.1。
