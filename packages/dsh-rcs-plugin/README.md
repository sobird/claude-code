# @sobird/dsh-rcs-plugin

把 **deepseek-harness（dsh）** 接到 **RCS** 的 dsh 主机插件（Cordis bundle）。它跑在 dsh
进程内：RCS 的一条 `cse_` 会话绑定一条专属 dsh 会话，RCS 的入站消息直接喂给
`agent.followup`，dsh 的会话事件、审批、提问再翻译回 RCS。相比独立进程的
[`@sobird/dsh-bridge`](../dsh-bridge)，它没有子进程、没有 JSON-RPC，停止走 `agent.cancel()`。

支持两种模式：`single`（默认，固定接一条 RCS 会话）和 `environment`（把本机注册成
RCS 环境，按 RCS Web 的派发起多条会话）。设计见
[`docs/superpowers/specs/2026-11-24-dsh-rcs-environment-bridge-design.md`](../../docs/superpowers/specs/2026-11-24-dsh-rcs-environment-bridge-design.md)。

## 安装

发布给 dsh 的包必须是**编译后的 ESM JS**（已安装的 dsh CLI 不带 TS loader），所以先构建，
再把包 checkout 装进 profile：

```bash
cd packages/dsh-rcs-plugin
bun run build

# 绝对路径；首次会初始化 sdk profile 模板
dsh plugin --profile sdk add /abs/path/to/claude-code/packages/dsh-rcs-plugin
dsh --profile sdk
```

启动后插件向 stderr 打印 `[dsh-rcs-plugin] attached to <base> session <cse_...>`，在 RCS 里
就能看到这条会话。后续更新代码后重新 `bun run build`，重启 profile 即生效（链接的是
checkout 本身）。

首次启动且没有任何凭据时，插件会自动走设备码配对：向 stderr 打印一个短码和
`<rcsBaseUrl>/device` 链接，打开该链接（未登录会先跳登录）输入短码确认后，插件自动拿到
API key 并写入 `$DSH_HOME/rcs-bridge/credentials.json`，无需手动生成 key 或改配置。

Web 端也可以走 **Plugins** 菜单用「安装本地插件」添加同一个绝对路径。

## 配置

字段级优先级：`config.<k>` > 环境变量 > 默认值。插件行默认没有 `config`，纯靠环境变量；
也可以在 profile 的 `cordis.patch.yml` 里覆盖（包括 `apiKey`）。

`apiKey` 的来源优先级是：`config.apiKey` > `RCS_API_KEY` > 本机 `credentials.json`（配对所得）>
自动设备码配对。前三者任一命中即跳过配对，适合脚本 / CI；headless 环境请显式设
`RCS_API_KEY`，否则首次启动会阻塞等待配对（最长约 10 分钟）。

```yaml
- id: rcs-bridge
  name: '@sobird/dsh-rcs-plugin'
  config:
    apiKey: rcs_xxx
    rcsBaseUrl: http://localhost:4000
    workdir: /srv/work
```

| 字段（config / 环境变量）              | 必填 | 默认                    | 说明                                                    |
| -------------------------------------- | ---- | ----------------------- | ------------------------------------------------------- |
| `apiKey` / `RCS_API_KEY`               | 否   | 自动设备码配对          | 能创建会话的用户 API key；显式配置则跳过配对            |
| `rcsBaseUrl` / `RCS_BASE_URL`          | 否   | `http://localhost:4000` | RCS 网关根地址                                          |
| `workdir` / `DSH_WORKDIR`              | 否   | dsh 进程当前目录        | dsh 会话工作目录                                        |
| `sessionTitle` / `RCS_SESSION_TITLE`   | 否   | —                       | 新建 RCS 会话的标题，同时设为 dsh 会话标题              |
| `provider` / `DSH_PROVIDER`            | 否   | `deepseek-official`     | dsh 的 provider                                         |
| `model` / `DSH_MODEL`                  | 否   | `deepseek-v4-flash`     | dsh 的模型                                              |
| `sessionId` / `RCS_SESSION_ID`         | 否   | —                       | `single` 模式下复用既有 RCS 会话（不再新建）            |
| `mode` / `RCS_BRIDGE_MODE`             | 否   | `single`                | `single` 或 `environment`；后者注册本机环境             |
| `environmentId` / `RCS_ENVIRONMENT_ID` | 否   | —                       | 复用既有环境 id；缺省读取 `$DSH_HOME` 里的上次注册      |
| `maxSessions` / `RCS_MAX_SESSIONS`     | 否   | `4`                     | `environment` 模式并存活桥上限（注册为 `max_sessions`） |

模型凭据（例如 `DEEPSEEK_API_KEY`）由 dsh 宿主自己读取，插件不碰。

如果 RCS 是 dev HTTPS（`~/certificates` 或 `RCS_DEV_TLS_CERT/KEY` 存在时 `bun run rcs:dev`
会自动启用），`rcsBaseUrl` 要写 `https://localhost:4000`，并让 dsh 进程信任本地 CA：
`NODE_EXTRA_CA_CERTS="$HOME/Library/Application Support/mkcert/rootCA.pem"`。

插件只写 stderr，绝不写 stdout——SDK profile 的 stdout 属于 JSON-RPC。

## 行为

- **会话**：启动时优先复用最近一条工作目录一致的 `cse_` 会话（与 dsh Web UI 同源的
  `sessionQuery` 列表），向 RCS `openWorker` 探测可用后继续；探测失败或没有候选才新建。
  dsh agent 仍延迟到首次 prompt 时创建：有落盘记录就 `resume`，否则 `create`，避免与
  agent-loop 的加载顺序竞争。日志区分 `(configured)` / `(reused)` / `(created)`。
- **工作区**：建/恢复会话后把 `workdir` 注册成工作区（已注册则复用）并挂载该会话，
  dsh 侧边栏才会按工作区分组；`sessionTitle` 同时重命名为 dsh 会话标题。缺少
  `workspaceRegistry` 服务（例如 SDK profile）或挂载失败只记 stderr，会话仍落在「未分组」。
- **入站**：文本直接转成冻结的 user message；图片经 `attachments.admitPromptContent`
  换成持久引用（profile 缺该服务时报错并回一条 error result）。
- **双向同步**：dsh Web UI 里键入的 `user/message`（`source.kind === 'user'`）按消息 id
  回发成 RCS 的 `user` 事件；插件自己从 RCS 注入的消息记在内存里，会话事件回发时跳过。
  仅同步文本——图片在 dsh 侧已换成持久引用，RCS 无法渲染。
- **出站**：`session/event` 按 `translateSessionEvent` 翻译成 `assistant` / `tool_use` /
  user `tool_result` / `result`，串行上报保证顺序。
- **流式**：`agent/assistant-stream` 的 `text-delta` / `reasoning-delta` 累积后约 80ms
  合批发成临时 `stream_event`（`content_block_delta`），最终 `assistant/message` 前先
  flush，RCS 侧气泡随生成增量刷新；`start` 发 `message_start`，停止/中断时丢弃缓冲。
- **审批**：`approval/request` 发 `can_use_tool` 卡片并置 `requires_action`；回执为允许时记
  住 `updatedPermissions` 里的「总是允许」，本进程内命中即短路放行。非本 agent 的请求
  `next()` 交回其它监听器。
- **提问**：plan-review 渲染成 `ExitPlanMode` 卡片，其它渲染成 `AskUserQuestion`。
- **中断**：RCS 的 `interrupt` 先给挂起卡片补 `control_response`，再 `agent.cancel()`；
  `aborted` result 由宿主随后的 `turn/end` 自然产生。
- **卸载**：插件 dispose 时中止 SSE/心跳、收尾挂起卡片、取消 agent 并置 `idle`。

### 环境模式（`mode: environment`）

- **注册**：启动时用用户 API key `POST /v1/environments/bridge` 注册本机环境（`machine_name`
  = 主机名、`directory` = `workdir`、`max_sessions` = `maxSessions`），把环境 id 写入
  `$DSH_HOME/rcs-bridge/environment.json`，并尽力 `bridge/reconnect` 重排在飞会话。
- **派发**：长轮询 `work/poll`，收到 `work` 项后 `ack`，用 work secret 重建 `WorkerSession`，
  按 sidecar 反查 dsh 会话 id，再起一条 `InProcessBridge`；同一 `cse_` 会话幂等，重复派发
  不会重复起桥。存活桥数达到 `maxSessions` 时暂停轮询，槽位随桥移除释放。
- **容错**：poll/上报返回 401 时用用户 key 重注册环境、换新 secret；会话被删（404）时
  该桥经 `onGone` 自行停止并让出槽位。dispose 时停掉全部桥并注销环境。
- **斜杠命令**：`/rcs-max-sessions <n>` 运行时改上限（重注册环境，不停存活桥）；
  `/rcs-sync` 把当前 dsh 会话同步成一条新 RCS 会话（见下）。两者都依赖 profile 的
  `commands` 服务，缺失时只记 stderr、不注册。

### 配对命令（与模式无关）

`/rcs-login` 无视已存凭据重新发起设备码配对并覆盖 `credentials.json`。命令会**立即**把
批准链接与短码放进返回值（dsh Web UI 只显示命令结果气泡、看不到 stderr，这样在 Web UI 里
也能拿到短码）。链接带 `#code=`，批准页会预填短码并自动预览机器，但**批准仍需手动点击**；
批准后的轮询与落盘在后台继续，成功率不影响返回值；运行中的客户端仍持旧 key，需重启 profile
生效。`/rcs-logout` 删除本机凭据文件（若环境变量或配置仍提供 key，则
继续生效）。二者在 `single` / `environment` 两种模式下都注册，单会话模式下环境类命令会
返回「仅在环境模式可用」的提示。

### 手动同步（`/rcs-sync`）

把一条既有 dsh 会话（如 `session-<uuid>`）推给 RCS：以 dsh 会话标题新建一条带
`environment_id` 的 RCS 会话、`openWorker`、挂到 supervisor 上，并在 sidecar
（`$DSH_HOME/rcs-bridge/sessions.json`）记录 `dshId ↔ rcsId` 映射。之后该会话的后续轮次
双向同步；**历史消息不回填**。重复执行命中 sidecar 时只回显既有 rcsId，不再新建；
`cse_` 开头的会话已由 RCS 管理，直接跳过。

## 测试

```bash
cd packages/dsh-rcs-plugin
bun test        # 假 Cordis 上下文 + FakeRcs，无 Postgres/网络
bun run typecheck
bun run build   # 产物断言不含 @sobird/、@deepseek-ai/ 运行时导入
```

### 真实端到端（可选，不进 `bun test`）

`scripts/e2e.ts` 在临时 `DSH_HOME` 里 `dsh plugin add` 本包，再起真网关 + 真 dsh + 真模型，
跑文本轮、bash 工具轮和 interrupt：

```bash
cd packages/dsh-rcs-plugin

DSH_REPO=/path/to/deepseek-harness \
DEEPSEEK_API_KEY=sk-xxx \
bun run e2e
```

脚本变量与 `packages/dsh-bridge/scripts/e2e.ts` 一致：`DATABASE_URL` / `RCS_AUTH_SECRET`
（默认读 `packages/rcs/.env`）、`DSH_REPO` 或 `DSH_BIN`、`DEEPSEEK_API_KEY`、
`E2E_RCS_PORT`（默认 4100）、`E2E_RCS_API_KEY`、`DSH_PROVIDER` / `DSH_MODEL`、
`NODE_BIN`、`E2E_VERBOSE=1`。首次安装需要网络与 pnpm。

## 结构

| 文件                       | 职责                                                                |
| -------------------------- | ------------------------------------------------------------------- |
| `src/index.ts`             | 插件入口：`name` / `inject` / `apply`，注册 disposer                |
| `src/config.ts`            | config + env 的字段级解析与校验                                     |
| `src/message.ts`           | 冻结的 user message（复刻 dsh-llm 的 `createUserMessage`）          |
| `src/bridge.ts`            | 单会话编排：SSE、事件翻译、审批/提问、interrupt/stop                |
| `src/supervisor.ts`        | 环境模式：注册、work 轮询/ack、多桥生命周期、maxSessions            |
| `src/sync.ts`              | `/rcs-sync`：把既有 dsh 会话推成 RCS 会话（不回填历史）             |
| `src/commands.ts`          | `/rcs-max-sessions`、`/rcs-sync`、`/rcs-login`、`/rcs-logout`       |
| `src/credentials.ts`       | `credentials.json` 的读写（0700 目录 / 0600 原子写，损坏转 `.bak`） |
| `src/credentials-flow.ts`  | `ensureCredentials`：命中复用 / 设备码配对编排与轮询                |
| `src/device-auth.ts`       | 设备码端点客户端（`requestCode` / `pollToken`，免鉴权）             |
| `src/open-browser.ts`      | 跨平台打开配对链接（仅 http(s)，失败静默）                          |
| `src/sidecar.ts`           | `$DSH_HOME/rcs-bridge/sessions.json` 的读写与双向 id 映射           |
| `src/environment-state.ts` | 环境 id 的持久化（`environment.json`）                              |
| `src/types.ts`             | 最小结构化 Cordis 类型与运行时守卫                                  |
| `cordis.patch.yml`         | bundle 补丁：`insert` 一行 `rcs-bridge`                             |
| `scripts/build.ts`         | Bun.build 打成单个 `lib/index.js`（内联 core，零运行时依赖）        |
| `plugin-market/`           | 发布到 Discover 的索引样例（npm 源）                                |

## 发布物料

- `bun run build` → `lib/index.js`；`files` 只带 `lib/index.js`、`cordis.patch.yml`、`src`、`README.md`。
- `engines.dsh` 为 `>=0.2.3-alpha.2 <0.3.0`，与快照的 dsh 版本对齐；升级 dsh 时同步调整。
- `plugin-market/index.json`：`format: 1` 的索引，版本 `source` 为 `npm`。发布后把该文件与
  图标放到任意静态主机，在 dsh 的 Plugins → Discover 里「添加索引源」填它的 URL。
  本地路径不被市场接受，本地调试请用 `dsh plugin add`。

## 已知限制

- 「总是允许」只记在插件进程内存里（按 `sessionId + toolName`），重启后失效。
- 一条 RCS 会话对应一条专属 dsh 会话；不支持镜像/接管用户现有的 UI 会话。
- 与独立桥不要同时接同一条 RCS 会话（会互相抢 worker 状态）。
- 自动复用按 `sessionQuery` 列表 + 工作目录挑最新的 `cse_` 会话。多个桥或多台机器共用同一
  `$DSH_HOME` 与 RCS 账号时可能选中对方的会话，请显式配置 `sessionId` 区分。
- 插件声明依赖 `agents` 与 `sessionQuery`，都由 dsh-base 提供；`sdk-minimal` 这类不叠 base
  的 profile 不会加载本插件。
- 环境模式的本地状态都在 `$DSH_HOME/rcs-bridge/`：`environment.json`（上次环境 id）、
  `sessions.json`（`/rcs-sync` 的双向 id 映射）；文件 0600、原子写，损坏时改名 `.bak` 并从空
  映射重建。
- 环境模式默认假设「一个 RCS 账号 + 一台本机」。多个 dsh 进程共用同一 `$DSH_HOME`、或同一
  环境被多台机器注册时，环境 id 与会话归属可能互相覆盖；请显式配置 `environmentId` / `sessionId`。
- 首次启动的自动配对会阻塞 `apply`，最长等满设备码有效期（约 10 分钟）。headless / 无人值守
  场景请设 `RCS_API_KEY` 跳过配对。
- 凭据文件绑定 `rcsBaseUrl`：换 RCS 服务器会重新配对（有意为之）。明文 key 只经 TLS 传输，
  部署务必启用 HTTPS。
- C 路径（重启后重连）依赖 `bridge/reconnect` 让 RCS 重投在飞会话；服务端 `reclaim_older_than_ms`
  兜底，最坏情况下会话要等 reclaim 窗口过去才会被重新派发。
- `/rcs-*` 斜杠命令只在 profile 提供 `commands` 服务时注册；`environment` 模式本身不依赖它。
