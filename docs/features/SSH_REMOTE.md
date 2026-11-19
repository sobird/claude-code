# SSH_REMOTE：`claude ssh` 远程会话

`SSH_REMOTE` 启用 `claude ssh` —— 把本地 CLI 作为“控制端”，把实际的 Claude Code 会话放到远端主机上运行。工具在远端执行，而 UI、权限确认、中断、鉴权都在本地完成；远端的 API 请求经 SSH 反向隧道回到本地注入真实凭据，**真实 API Key / OAuth token 不会离开本地机器**。

启用位置：`scripts/config.ts` 的 `features` 数组中的 `SSH_REMOTE`（`bun run dev` 通过 `--feature SSH_REMOTE` 生效）。

## 核心流程

1. 本地解析 `claude ssh <user@host> [dir]`，剥出 ssh 相关参数。
2. **探测远端**：`ssh -o BatchMode=yes host 'command -v claude; claude --version'`。
   - 找到 `claude` → 直接复用其路径。
   - 找不到且当前是 **Bun 编译的单文件二进制**（`isInBundledMode()`）→ 把 `process.execPath` 经 `ssh 'cat > … && chmod +x'` 流式部署到远端 `/tmp` 后执行。
   - 找不到且非编译态 → 抛 `SSHSessionError`，提示远端已装或改用 bundled build。
3. 本地起一个 **unix-socket 鉴权代理**，用 `ssh -R <远端socket>:<本地socket>` 把远端的 socket 反向前转到本地。
4. 远端以 `claude --print --input-format stream-json --output-format stream-json --verbose --permission-prompt-tool stdio` 运行，stdin/stdout 为 NDJSON 帧。
5. 本地 `SSHSessionManager` 驱动这套帧：转发用户消息与中断、把远端的 `can_use_tool` 权限请求交给本地 REPL，再把用户决定回写。

## 架构与数据流

```
本地 REPL ──SSHSessionManager──┬── stdin  (user / interrupt / control_response)
                              │
                              └── stdout (SDKMessage / can_use_tool / control_cancel)
                                      ▲
                         ssh 子进程（远端 claude，print+stream-json）
                                      │  ANTHROPIC_UNIX_SOCKET=<远端socket>
                              ssh -R 反向隧道
                                      ▼
                        本地 unix-socket 鉴权代理 ── 注入真实凭据 ──> api.anthropic.com
```

### 鉴权契约

- 远端进程设 `ANTHROPIC_UNIX_SOCKET=<远端 socket>`，Bun 的 `fetch`（经 `getProxyFetchOptions({ forAnthropicAPI: true })` 返回 `{ unix }`）把请求送到该 socket，而不是公网。
- 远端还设 `ANTHROPIC_BASE_URL=http://api.anthropic.com`：Bun 对 `https://` + unix socket 会尝试 TLS，因此代理走**纯 HTTP**，必须用 `http://` base URL。
- 远端只拿到**占位凭据**：订阅用户设 `CLAUDE_CODE_OAUTH_TOKEN=ssh-proxy-placeholder`（使远端携带 oauth beta），否则设 `ANTHROPIC_API_KEY=ssh-proxy-placeholder`。
- 代理收到请求后剥离入站的 `authorization` / `x-api-key` / `host` / `content-length` / `anthropic-beta`，再按**与本地客户端一致**的优先级注入真实凭据（`resolveProxyAuthHeaders`）：
  1. 订阅用户 → OAuth 头（`Authorization: Bearer <oauth>` + oauth beta）；
  2. 否则若存在 `ANTHROPIC_AUTH_TOKEN`（或 `apiKeyHelper`）→ `Authorization: Bearer <token>`；
  3. 否则回退 `getAuthHeaders()`（`x-api-key`）。
     然后对 `anthropic-beta` 取并集，转发上游。
     > 这一步很关键：很多 Anthropic 兼容网关（如 DeepSeek `/anthropic`）只认 **Bearer token**，对占位的 `ANTHROPIC_API_KEY` 会返回 401。只注入 `x-api-key` 会导致远端一直重试、表现为“聊天不回复”。
- 代理向上游请求 `accept-encoding: identity`，并在回传时删除 `content-encoding` / `content-length`。因为 Bun 的 `fetch` 已透明解压响应体，若保留原始压缩头，下游会二次解压并报 `ZstdDecompressionError`。
- 由 settings 提供的 `env` 会经 `withoutSSHTunnelVars` 去掉隧道/鉴权变量，避免覆盖代理注入；launcher 直接设置的进程环境则保留。

### NDJSON 协议

- stdin 写入：
  - `{ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id? }`
  - `{ type: 'control_request', request_id, request: { subtype: 'interrupt' } }`
  - `{ type: 'control_response', response: { subtype: 'success', request_id, response: { behavior, ... } } }`（allow 带 `updatedInput`，deny 带 `message`）
- stdout 读取：
  - 合法 `SDKMessage` → 转发给 REPL
  - `control_request` 且 `subtype: 'can_use_tool'` → 存 pending 并交给本地权限 UI；其他 subtype 回 `control_response/error`，避免远端挂起
  - `control_cancel_request` → 删除对应 pending
  - `control_response` / `keep_alive` → 忽略
  - 非法行只记调试日志，不致命

## 快速开始

### 前置准备（缺一不可）

1. **本地用 Bun 运行**（不能用 Node / npm 安装版）：
   ```bash
   bun run dev ssh ...        # 源码模式；或
   bun dist/cli.js ssh ...    # 由 bun 执行构建产物
   ```
2. **配置免密 SSH**（`ssh -o BatchMode=yes` 不会弹密码，没配 key 会直接失败）：
   ```bash
   ssh-copy-id user@host
   ssh -o BatchMode=yes user@host true   # 必须成功且不提示输入密码
   ```
   也可写到 `~/.ssh/config`（别名、端口、私钥）。
3. **远端准备一个“能被 Bun 运行”的 claude**，见下面三种方式选其一。

### 方式一：远端已装（Bun 可运行的）claude

远端能 `command -v claude` 找到即可，直接连：

```bash
bun run dev ssh user@host              # 远端默认 ~ 作为 cwd
bun run dev ssh user@host /srv/app     # 指定远端目录
bun run dev ssh myhost                 # 使用 ~/.ssh/config 别名
```

### 方式二：编译成独立二进制，由本地自动部署（远端无需预装）

用 `bun build --compile` 打出单文件二进制后，**用它**发起会话；远端找不到 claude 时会把该二进制推到远端 `/tmp` 执行：

```bash
# 按远端平台交叉编译：Linux x64 / Linux arm64 / macOS …
bun -e '
import { define, features, banner, external } from "./scripts/config.ts"
const r = await Bun.build({
  entrypoints: ["src/entrypoints/cli.tsx"],
  compile: { outfile: "./claude-linux", target: "bun-linux-x64" },
  minify: true,
  define: define("external"),
  features,
  banner,
  external: [...external],
})
if (!r.success) { console.error(r.logs); process.exit(1) }
console.log("built ./claude-linux")
'
./claude-linux ssh user@host /srv/app
```

> 注意：`external` 中的 `@vscode/ripgrep`、`sharp` 是原生模块，`--compile` 不会嵌入；若远端的 Grep/图片等用到它们会缺依赖。纯编辑类操作通常不受影响。

### 方式三：远端手动放一个 Bun 包装脚本（最稳）

不依赖编译态，远端装好 Bun 后，把 `dist/cli.js` 传过去，放一个名为 `claude` 的包装脚本进 PATH：

```bash
# 本地：产出 bundle 并上传
bun run build
ssh user@host 'mkdir -p /opt/claude'
scp dist/cli.js user@host:/opt/claude/cli.js
# 远端：写包装脚本
ssh user@host 'cat > /usr/local/bin/claude <<"EOF"
#!/bin/sh
exec bun /opt/claude/cli.js "$@"
EOF
chmod +x /usr/local/bin/claude && /usr/local/bin/claude --version'
```

之后 `bun run dev ssh user@host` 即会复用远端 `/usr/local/bin/claude`。

> 远端仍需 Bun（隧道依赖其 unix-socket fetch）；且 `dist/cli.js` 是 node 目标的 ESM bundle，若用到 `@vscode/ripgrep`/`sharp`，需在远端相应位置放好这两个包，否则相关工具会缺能力。

### 方式四：本地自测（不需要真实远端）

```bash
bun run dev ssh localhost --local
```

`--local` 跳过 ssh 与部署，直接以 stream-json 协议在本机起当前 CLI 子进程，用于单独验证鉴权代理与 unix-socket 链路。

## 参数说明

| 参数                             | 作用                                                         |
| -------------------------------- | ------------------------------------------------------------ |
| `<host>`                         | `user@host` 或 `~/.ssh/config` 别名（位置参数，必填）        |
| `[dir]`                          | 远端工作目录，缺省为远端 `~`                                 |
| `--local`                        | 本地自测模式，跳过 ssh/部署（host 可写任意占位值）           |
| `--permission-mode <mode>`       | 远端会话的权限模式（如 `acceptEdits`、`plan`、`default`）    |
| `--dangerously-skip-permissions` | 远端跳过所有权限确认（危险）；优先级高于 `--permission-mode` |
| `-c` / `--continue`              | 续接远端最近会话（作用于远端历史）                           |
| `--resume <uuid>`                | 恢复远端指定会话                                             |
| `--model <model>`                | 指定远端使用的模型                                           |

参数可放在 host 前后；`-p`/`--print` 与 `claude ssh` 互斥，v1 不支持。

## 交互与生命周期

- 会话启动后：**工具在远端执行**，权限确认卡在**本地**弹出；你在本地输入、确认、按 `Ctrl+C`，中断会以 control_request 发往远端。
- 远端 API 请求经 `-R` 反向隧道回到本地代理，凭据在本地注入；远端只见到占位符。
- 退出时 `proxy.stop()` 关闭代理并清理 unix socket；ssh 断开时由 ssh 自身回收远端 `/tmp` socket。

## 注意事项（常见报错与处理）

| 现象 / 报错                                    | 原因                                                                            | 处理                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `SSH sessions require the Bun runtime`         | 当前 CLI 跑在 Node 上（如 npm 安装版、`node dist/cli.js`）                      | 改用 `bun run dev ...` 或 `bun dist/cli.js ...`                                 |
| `claude was not found on <host> …`             | 远端无 `claude`，且本地不是编译态（`isInBundledMode()` 为 false），无法自动部署 | 用「方式二」编译二进制，或「方式三」在远端放包装脚本                            |
| 远端返回 401 / 请求直连上游                    | 远端 `claude` 是 **Node 版**，无 unix-socket fetch，拿到的是占位符凭据          | 远端必须换成 **Bun 可运行**的 claude（方式二/三）                               |
| 聊天一直转圈、不回复；日志反复 `api_retry` 401 | 本地占用位 `ANTHROPIC_API_KEY`，但网关只认 Bearer                               | 代理已按客户端优先级改用 `ANTHROPIC_AUTH_TOKEN`（Bearer）；确保本地设置了该变量 |
| `ZstdDecompressionError`                       | 代理转发了已解压的响应体却保留 `content-encoding`，下游二次解压                 | 已在代理处理（请求 identity、回删压缩头）；更新到最新实现即可                   |
| `ssh` 卡住或提示输入密码                       | `BatchMode=yes` 下无可用密钥                                                    | `ssh-copy-id` 或配置 `~/.ssh/config`；先验证 `ssh -o BatchMode=yes host true`   |
| `headless (-p/--print) mode is not supported`  | `-p` 与 ssh 互斥                                                                | 去掉 `-p/--print`，改用交互式 REPL                                              |
| 中途断开后回合丢失                             | 自动重连最多 3 次，重连会新建远端会话                                           | 断开后重发；需长任务可降低断开概率（稳定网络/SSH keepalive）                    |
| 版本不一致提示                                 | 远端 claude 与本地版本不同                                                      | 仅是进度提示，不阻断，可忽略                                                    |
| 旧 socket 导致 `EADDRINUSE`                    | 上次会话异常退出残留                                                            | 代理启动时会自动 `unlink` 旧 socket，一般无需手工处理                           |

### 其它约定

- **必须在 Bun 下运行**：实现依赖 `Bun.spawn`、`Bun.serve({ unix })`、unix-socket `fetch`。
- **远端也必须能跑 Bun**：隧道依赖 Bun 的 unix-socket fetch。
- **自动部署仅在编译态生效**：`isInBundledMode()` 依赖 `Bun.embeddedFiles`，只有 `bun build --compile` 的单文件二进制才有；本仓库 `scripts/build.ts` 的 `compile: true` 目前被注释，普通 `bun run build` 产物不触发自动部署。
- **免密登录**：ssh 用 `-o BatchMode=yes`，不会弹密码。
- **不支持无头模式**：`-p/--print` 与 `claude ssh` 互斥。
- **重连**：ssh 传输层异常时最多自动重连 3 次，进行中的回合会丢失；远端 socket 用 `/tmp` 绝对路径，避免 `~` 在 sshd 端不展开。

## 代码位置

| 文件                           | 职责                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `src/ssh/createSSHSession.ts`  | 工厂：`createSSHSession`（真实 ssh）/ `createLocalSSHSession`（`--local`），命令构造、探测/部署、子进程 transport |
| `src/ssh/sshAuthProxy.ts`      | 本地 unix-socket 鉴权代理（`createAuthProxy`）                                                                    |
| `src/ssh/protocol.ts`          | NDJSON 编解码、`LineDecoder`、`StderrTail`                                                                        |
| `src/ssh/SSHSessionManager.ts` | 帧驱动、权限路由、中断、重连（`createSSHSessionManager`）                                                         |
| `src/hooks/useSSHSession.ts`   | REPL 侧生命周期绑定与 cleanup                                                                                     |
| `src/main.tsx`                 | argv 解析（`ssh`/`--local`/参数剥离）、会话启动分支、`ssh` 子命令的 `--help`                                      |
| `src/utils/proxy.ts`           | `getProxyFetchOptions` 的 unix-socket 分支                                                                        |
| `src/utils/managedEnv.ts`      | `withoutSSHTunnelVars`：过滤 settings 来源的隧道变量                                                              |
| `src/utils/bundledMode.ts`     | `isInBundledMode()` 判定编译态                                                                                    |

## 测试

```bash
bun test src/ssh
```

覆盖：帧编解码与残行处理、鉴权代理的凭据替换/`anthropic-beta` 合并/401·502/清理 socket、manager 的权限路由与断开/重连、工厂的纯函数与 `--local` 端到端子进程帧流。
