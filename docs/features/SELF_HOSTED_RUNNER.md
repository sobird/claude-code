# SELF_HOSTED_RUNNER：`claude self-hosted-runner` 自托管工作进程

`SELF_HOSTED_RUNNER` 启用 `claude self-hosted-runner` —— 一个独立、无头的 **Remote Control 工作进程**，供自托管（self-hosted）部署直接运行。它是 daemon 里 `remoteControl` worker 的 CLI 版本：二者都调用 `runBridgeHeadless`，向配置的 bridge 服务器注册一个 **environment**，然后跑 work 轮询循环；**轮询本身就是心跳**（poll IS heartbeat）。

区别只在配置来源与生命周期：

|           | daemon `remoteControl` worker                                                    | `claude self-hosted-runner`      |
| --------- | -------------------------------------------------------------------------------- | -------------------------------- |
| 启动方式  | `claude --daemon-worker remoteControl`（supervisor 托管）                        | 直接 `claude self-hosted-runner` |
| 配置来源  | `DAEMON_WORKER_*` 环境变量                                                       | CLI 参数                         |
| 退出码    | `EXIT_CODE_PERMANENT`(78) / `EXIT_CODE_TRANSIENT`(1) 供 supervisor 决定重试/停靠 | 0（干净退出）/ 1（任意错误）     |
| 熵权 gate | GrowthBook + 版本 + 组织策略                                                     | 无（self-hosted 绕过，见下）     |

启用位置：`scripts/config.ts` 的 `features` 数组中的 `SELF_HOSTED_RUNNER`（`bun run dev` 通过 `--feature SELF_HOSTED_RUNNER` 生效）。入口在 `src/entrypoints/cli.tsx`，`feature()` 保持内联字面量以便构建期做死代码消除。

## 核心流程

1. 解析 CLI 参数（`--dir`/`--spawn`/`--capacity`/…），校验非法值。
2. 检查是否已登录（`getBridgeAccessToken()` 为 undefined 时打印登录提示并退出 1）。
3. 装 SIGTERM/SIGINT 处理器，把它们接到 `AbortController`。
4. 调 `runBridgeHeadless(opts, signal)`：
   - `chdir(dir)`、初始化配置与 sinks、校验工作区 trust 对话框、检查 HTTPS（非 localhost 拒绝 `http://`）、worktree 模式的可用性（git 仓库或 WorktreeCreate hook）。
   - `POST /v1/environments/bridge` 注册 environment，得到 `environment_id` / `environment_secret`。
   - 可选预建一条初始会话（`--[no-]create-session`）。
   - 跑 `runBridgeLoop`：轮询 work → ack → 解码 work secret → spawn 子 CLI（`sessionRunner`）→ 监管到结束 → stopWork；容量满时以 at-capacity 轮询作为心跳。
5. `signal` 触发（SIGTERM/SIGINT）→ 循环 teardown → `runBridgeHeadless` 正常返回 → runner `dispose()` 掉信号监听并退出 0。

## 架构与数据流

```
claude self-hosted-runner
   └── runSelfHostedRunner(args)
         ├── parseSelfHostedRunnerArgs ──► HeadlessBridgeOpts
         ├── getBridgeAccessToken()（无 → 退出 1）
         ├── installSignals()（SIGTERM/SIGINT → AbortSignal）
         └── runBridgeHeadless(opts, signal)
               ├── 校验 trust / HTTPS / worktree
               ├── POST /v1/environments/bridge ──► env_id, env_secret
               ├── [可选] POST /v1/sessions（预建会话）
               └── runBridgeLoop
                     ├── GET  /v1/environments/{env}/work/poll（poll = heartbeat）
                     ├── POST .../work/{id}/ack
                     ├── spawn 子 CLI（--sdk-url stream-json，RemoteIO 直连 Ingress/CCR）
                     └── POST .../work/{id}/stop（会话结束）
```

模型与权限流量由子进程的 `RemoteIO` 直连 Session Ingress / CCR，runner 只做控制平面（注册 + 轮询 + spawn 监管），不中转数据平面。

## 快速开始

```bash
# 在当前目录启动一个自托管工作进程，最多 4 个并发会话
bun run dev self-hosted-runner

# 指定目录、worktree 隔离、2 并发、plan 权限、沙箱
bun run dev self-hosted-runner \
  --dir /srv/app --spawn worktree --capacity 2 --permission-mode plan --sandbox

# 不预建会话（等远端投递 work 再按需创建）
bun run dev self-hosted-runner --no-create-session
```

worker 运行后即向配置的 bridge 服务器注册 environment 并开始轮询；在 claude.ai/code（或自托管 RCS 前端）发起会话即可派发到此 worker。

## 参数说明

| 参数                                       | 作用                                                  |
| ------------------------------------------ | ----------------------------------------------------- |
| `--dir <path>`                             | 工作目录（默认当前目录）                              |
| `--name <name>`                            | 预建会话的显示名                                      |
| `--spawn <mode>`                           | `same-dir` \| `worktree`（默认 `same-dir`）           |
| `--capacity <N>`                           | 最大并发会话数（默认 4）                              |
| `--permission-mode <mode>`                 | 子会话权限模式（如 `acceptEdits`、`plan`、`default`） |
| `--sandbox` / `--no-sandbox`               | 是否在沙箱中运行子会话                                |
| `--session-timeout <secs>`                 | 单会话超时（秒）                                      |
| `--create-session` / `--no-create-session` | 启动时是否预建一条会话（默认预建）                    |
| `-h, --help`                               | 打印用法                                              |

支持 `--flag value` 与 `--flag=value` 两种写法。

## 退出码

| 结果                           | 退出码 |
| ------------------------------ | ------ |
| SIGTERM/SIGINT 干净退出        | `0`    |
| 未登录 / 参数错误 / 运行期错误 | `1`    |

`BridgeHeadlessPermanentError`（工作区未信任、非 localhost 的 `http://` bridge、worktree 不可用）以 `permanent error: …` 前缀记录；其它错误以 `error: …` 记录。二者都为退出码 1——与 daemon worker 不同，这里没有 supervisor 需要区分“停靠 vs 重试”。

## 注意事项

- **self-hosted 绕过 GrowthBook**：`isSelfHostedBridge()`（设置了自定义 bridge base URL）会让 `getBridgeDisabledReason` 直接放行；本命令不再额外检查版本/组织策略 gate，需自行保证服务端版本兼容。
- **必须已登录**：没有 bridge access token 时直接退出 1 并提示登录（daemon worker 则会抛 transient 让 supervisor 重试）。
- **HTTPS 强制**：bridge base URL 为 `http://` 且非 localhost / 127.0.0.1 时，`runBridgeHeadless` 抛 `BridgeHeadlessPermanentError`。
- **worktree 模式前提**：目标目录要么是 git 仓库，要么配置了 WorktreeCreate hook，否则永久错误。
- **trust 对话框**：工作目录需先被信任（在该目录运行过一次 `claude` 接受 trust），否则永久错误。
- **poll 即心跳**：容量满时以慢轮询（at-capacity）维持 environment 存活；无需单独的 heartbeat 循环（除非 server 下发了 `non_exclusive_heartbeat_interval_ms`）。
- **子进程凭据**：spawn 子 CLI 时剥离 `CLAUDE_CODE_OAUTH_TOKEN`，只下发 `CLAUDE_CODE_SESSION_ACCESS_TOKEN`（ingress token），OAuth 不会泄漏给子进程/MCP。

## 代码位置

| 文件                             | 职责                                                                        |
| -------------------------------- | --------------------------------------------------------------------------- |
| `src/self-hosted-runner/main.ts` | CLI 入口 `selfHostedRunnerMain` / `runSelfHostedRunner`、参数解析、信号处理 |
| `src/entrypoints/cli.tsx`        | `self-hosted-runner` 子命令快速路径（`feature('SELF_HOSTED_RUNNER')`）      |
| `src/bridge/bridgeMain.ts`       | `runBridgeHeadless`（本命令复用）、`BridgeHeadlessPermanentError`           |
| `src/bridge/bridgeConfig.ts`     | `getBridgeAccessToken` / `getBridgeBaseUrl` / `isSelfHostedBridge`          |
| `src/utils/auth.ts`              | `handleOAuth401Error`（401 刷新重试）                                       |
| `src/daemon/workerRegistry.ts`   | daemon 侧 `remoteControl` worker（同 `runBridgeHeadless` 的托管版本）       |

## 测试

```bash
bun test src/self-hosted-runner
```

覆盖：参数解析（默认值、空格/`=` 两种写法、布尔开关、非法 `--spawn`/`--capacity`/`--session-timeout`、未知参数）、`runSelfHostedRunner` 的 `HeadlessBridgeOpts` 装配、help/未登录/解析错误不启动、永久/瞬时错误的退出码与日志、信号句柄的安装与清理。
