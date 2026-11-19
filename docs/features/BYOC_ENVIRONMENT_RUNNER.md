# BYOC_ENVIRONMENT_RUNNER：`claude environment-runner` 容器内会话运行器

`BYOC_ENVIRONMENT_RUNNER` 启用 `claude environment-runner` —— 在 **客户自管容器（Bring Your Own Container）** 内执行单个 Claude Code 会话的无头进程。Go 的 `environment-manager` 负责拉起容器、克隆工作区，然后把一枚 base64url **work secret** 和一个 **session id** 交给这个进程；runner 只做「解 secret → 装配子进程环境/参数 → 拉起子 CLI 并监管到退出」，模型与权限流量由子进程的 `RemoteIO` 直连 Session Ingress / CCR，runner 本身不中转。

启用位置：`scripts/config.ts` 的 `features` 数组中的 `BYOC_ENVIRONMENT_RUNNER`（`bun run dev` 通过 `--feature BYOC_ENVIRONMENT_RUNNER` 生效）。入口在 `src/entrypoints/cli.tsx`，`feature()` 保持内联字面量以便构建期做死代码消除。

## 核心流程

1. **解析参数与 secret**：`--work-secret` / `--work-secret-file` / `CLAUDE_CODE_WORK_SECRET[_FILE]` 取原始 base64url，`decodeWorkSecret` 校验（`version===1`、非空 `session_ingress_token`、字符串 `api_base_url`）。session id 取 `--session-id` 或 `CLAUDE_CODE_REMOTE_SESSION_ID`。
2. **凭据 bootstrap**：读取 `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` / `CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR` 指向的管道，落盘到 `/home/claude/.claude/remote/…`，使无法继承 FD 的子进程（及其子进程）也能读到模型凭据。失败非致命（凭据可能已作为环境变量存在）。
3. **选择传输**：
   - 显式 `--sdk-url` 永远优先（`useCcrV2=false`）。
   - `secret.use_code_sessions === true` → **CCR v2**：`buildCCRv2SdkUrl` 得 `http(s)://host/v1/code/sessions/<id>`，再 `POST /worker/register` 取 `worker_epoch`。
   - 否则 → **v1 Session-Ingress**：`buildSdkUrl` 得 `ws(s)://host/{v1|v2}/session_ingress/ws/<id>`。
4. **装配子进程环境**：`buildChildEnv` 在继承的 base env 上盖 `byoc`/远程标记（见下），最后叠加 secret 的 `environment_variables`（可覆盖任何继承值）。
5. **装配子进程参数**：`buildChildArgs` 生成 `--print --sdk-url … --session-id … --input-format stream-json --output-format stream-json --replay-user-messages`，再追加 verbose/debug/permission/SDK 的 `claude_code_args` / `mcp_config`。
6. **拉起并监管**：`executeSession` 以 `stdio: ['ignore','pipe','pipe']` 起子进程，流式转发 stdout/stderr（env-manager 收集日志），把退出码映射为状态（`completed`→0、`interrupted`→130、其余→1）。

## 架构与数据流

```
environment-manager (Go)
   │  拉起容器 + 克隆工作区，注入 work secret + session id
   ▼
claude environment-runner
   ├── decodeWorkSecret ──┐
   ├── prepareTransport ──┤ v1: buildSdkUrl  / v2: buildCCRv2SdkUrl + registerWorker
   ├── buildChildEnv ─────┤ byoc 标记 + session token + runner 版本
   ├── buildChildArgs ────┘ --sdk-url …
   └── executeSession ── spawn ──> claude (--print --sdk-url)
                                      │  RemoteIO 直连
                                      ▼
                            Session Ingress (v1 WS) / CCR (v2)
                                      ▲
                              权限 / 模型流量（不经 runner）
```

### 子进程环境标记

| 变量                                      | 值                             | 作用                                      |
| ----------------------------------------- | ------------------------------ | ----------------------------------------- |
| `CLAUDE_CODE_ENVIRONMENT_KIND`            | `byoc`                         | 驱动文件持久化（需与下两项同时满足）      |
| `CLAUDE_CODE_REMOTE`                      | `1`                            | 标记远程会话；触发凭据落盘路径            |
| `CLAUDE_CODE_REMOTE_SESSION_ID`           | `<session id>`                 | 远程会话标识                              |
| `CLAUDE_CODE_SESSION_ACCESS_TOKEN`        | `secret.session_ingress_token` | Session Ingress 鉴权                      |
| `CLAUDE_CODE_ENVIRONMENT_RUNNER_VERSION`  | `<runner 版本>`                | Runner 版本头                             |
| `CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2` | `1`                            | v1 传输读写分离（WebSocket 读 / POST 写） |
| `CLAUDE_CODE_USE_CCR_V2`（仅 v2）         | `1`                            | 选用 CCR v2 传输                          |
| `CLAUDE_CODE_WORKER_EPOCH`（仅 v2）       | `<epoch>`                      | 由 `registerWorker` 返回的 worker 纪元    |

`secret.environment_variables` 在所有标记之后写入，可覆盖上述任意值。

## 快速开始

runner 由 `environment-manager` 在容器内调用；本地主要用于验证参数与协议：

```bash
# 直接用 work secret 运行（需有可用的 session id）
bun run dev environment-runner \
  --work-secret "$CLAUDE_CODE_WORK_SECRET" \
  --session-id "$CLAUDE_CODE_REMOTE_SESSION_ID"

# 或从文件读取 work secret，并显式指定工作目录
bun run dev environment-runner --work-secret-file /run/secrets/work.json \
  --session-id sess_abc --cwd /workspace
```

## 参数说明

| 参数                             | 作用                                                                 |
| -------------------------------- | -------------------------------------------------------------------- |
| `--work-secret <b64>`            | Base64url work secret（或 `CLAUDE_CODE_WORK_SECRET`）                |
| `--work-secret-file <path>`      | 含 base64url work secret 的文件（或 `CLAUDE_CODE_WORK_SECRET_FILE`） |
| `--session-id <id>`              | 会话 id（或 `CLAUDE_CODE_REMOTE_SESSION_ID`）                        |
| `--api-base-url <url>`           | 覆盖 secret 里的 `api_base_url`                                      |
| `--sdk-url <url>`                | 覆盖计算出的 ingress URL（显式指定时不做 v2 注册）                   |
| `--cwd <dir>`                    | 子进程工作目录（默认当前目录）                                       |
| `--permission-mode <mode>`       | 子进程权限模式                                                       |
| `--dangerously-skip-permissions` | 子进程跳过所有权限确认（优先级高于 `--permission-mode`）             |
| `--debug-file <path>`            | 子进程调试日志路径                                                   |
| `--verbose`                      | 子进程 verbose 输出                                                  |
| `-h, --help`                     | 打印用法                                                             |

优先级：`--work-secret` > `--work-secret-file` > `CLAUDE_CODE_WORK_SECRET` > `CLAUDE_CODE_WORK_SECRET_FILE`；`--session-id` > `CLAUDE_CODE_REMOTE_SESSION_ID`。

## 退出码

| 子进程结果                   | runner 退出码 |
| ---------------------------- | ------------- |
| 正常结束（exit 0）           | `0`           |
| 被信号中断（SIGTERM/SIGINT） | `130`         |
| 其它失败 / 错误              | `1`           |

## 注意事项

- **runner 不中转模型或权限流量**：子进程用 `--sdk-url` 让 `RemoteIO` 直连服务端，runner 只转发日志、监管进程。这与本地 bridge（`runBridgeHeadless` / daemon worker）不同：后者是本地注册 + 轮询的外部 worker，而本命令是**容器内的单会话执行器**。
- **work secret 必须合法**：`decodeWorkSecret` 要求 `version === 1`、非空 `session_ingress_token`、字符串 `api_base_url`，否则直接报错退出。
- **凭据 bootstrap 依赖 FD 环境变量**：没有 `*_FILE_DESCRIPTOR` 时什么也不做，依赖环境中已有凭据；读取失败只记调试日志，不阻断。
- **v2 需要 server 选择**：只有 `secret.use_code_sessions === true` 才走 CCR v2 并调用 `registerWorker`；否则默认 v1 Session-Ingress。
- **`--sdk-url` 覆盖会跳过 v2 注册**：显式传入时按 `useCcrV2=false` 处理。

## 代码位置

| 文件                                        | 职责                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/environment-runner/main.ts`            | 入口 `environmentRunnerMain` / `runEnvironmentRunner`、凭据 bootstrap、依赖注入 |
| `src/environment-runner/config.ts`          | 纯函数：参数/secret 解析、`claude_code_args` 展开、`byoc` env、v1/v2 传输选择   |
| `src/environment-runner/sessionExecutor.ts` | 子进程 spawn 与监管、stdout/stderr 转发、退出码→状态映射、abort 优雅 kill       |
| `src/entrypoints/cli.tsx`                   | `environment-runner` 子命令快速路径（`feature('BYOC_ENVIRONMENT_RUNNER')`）     |
| `src/bridge/workSecret.ts`                  | `decodeWorkSecret`、`buildSdkUrl`、`buildCCRv2SdkUrl`、`registerWorker`         |
| `src/utils/authFileDescriptor.ts`           | 从 FD 读取并落盘模型凭据                                                        |

## 测试

```bash
bun test src/environment-runner
```

覆盖：参数/secret 解析与优先级、`claude_code_args` 展开、子进程参数与 `byoc` 环境标记（含 server `environment_variables` 覆盖与 v2 epoch）、v1/v2 传输选择与 worker 注册、子进程 spawn 的退出码/中断映射，以及 `runEnvironmentRunner` 的端到端帧流（真实子进程 dump 环境）。
