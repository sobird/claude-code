# @sobird/dsh-bridge

把 **deepseek-harness（dsh）** 接到 **RCS** 的独立适配器。它作为一个单独的 Bun 进程运行，
用 dsh 的 SDK profile（`dsh --profile sdk`，JSON-RPC over stdio）驱动会话，把 RCS 的入站
消息喂给 dsh，再把 dsh 的事件、审批、提问翻译回 RCS。dsh 一律以
「SDK profile + RCS 的 `cse_` 会话 id」运行，停止后可用同一 id 恢复。

它本身不是 dsh 插件：RCS 传输（建会话、worker JWT、SSE、心跳、`requires_action`）留在桥里，
停止语义依赖杀掉 dsh 进程组，因此保持进程隔离更简单、更可重启。

也可以把同样的桥装进 dsh 宿主进程，从插件菜单添加：[`@sobird/dsh-rcs-plugin`](../dsh-rcs-plugin)。
它复用本包的 core（事件/审批翻译与 RCS 客户端），省掉子进程与 JSON-RPC，停止走 `agent.cancel()`；
本独立包保留给需要进程隔离或独立重启的场景。

## 运行

前置：

- 一个可用的 RCS 网关（默认 `http://localhost:4000`）和一个用户 API key；
- dsh 可执行：源码 checkout（`DSH_REPO`）或已安装（`DSH_BIN`）；
- dsh 的模型凭据（例如 `deepseek-official` 路由需要 `DEEPSEEK_API_KEY`），必须能被桥进程读到，
  因为桥会把自身环境透传给 dsh 子进程。

```bash
cd packages/dsh-bridge

RCS_API_KEY=rcs_xxx \
DSH_REPO=/path/to/deepseek-harness \
DEEPSEEK_API_KEY=sk-xxx \
bun run start
```

启动后会打印 `dsh-bridge attached to <base> session <id>`。Ctrl-C（SIGINT/SIGTERM）会优雅停止：
补发中断结果、释放待处理卡片并结束 dsh。

## 环境变量

| 变量                | 必填        | 默认                    | 说明                                                                                       |
| ------------------- | ----------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| `RCS_API_KEY`       | 是          | —                       | 能创建会话的用户 API key；网关 `RCS_API_KEYS` 里的 legacy key 同样可用（映射到首个 admin） |
| `RCS_BASE_URL`      | 否          | `http://localhost:4000` | RCS 网关根地址                                                                             |
| `RCS_SESSION_TITLE` | 否          | —                       | 新建会话的标题                                                                             |
| `DSH_WORKDIR`       | 否          | 当前目录                | dsh 会话工作目录，同时是 `workspace-write` 的边界                                          |
| `DSH_REPO`          | 否          | —                       | deepseek-harness 源码 checkout 绝对路径；设置后从源码启动（优先于 `DSH_BIN`）              |
| `DSH_BIN`           | 否          | `dsh`                   | 已安装的 dsh 可执行文件                                                                    |
| `NODE_BIN`          | 否          | `node`                  | `DSH_REPO` 模式下使用的 Node 可执行文件                                                    |
| `DSH_PROVIDER`      | 否          | `deepseek-official`     | dsh 的 provider                                                                            |
| `DSH_MODEL`         | 否          | `deepseek-v4-flash`     | dsh 的模型                                                                                 |
| `DEEPSEEK_API_KEY`  | 依 provider | —                       | dsh 模型路由的凭据（`deepseek-official` 必需）                                             |

### dsh 的启动方式

- **`DSH_REPO`**：执行
  `node --import tsx/esm apps/cli/src/bin.ts --profile sdk`，
  cwd 为 checkout 根目录。**必须用 Node**：dsh 的原生插件需要 V8 context，Bun 不满足
  （会报 `node-addon-require-builtin ... has_v8_context: false`）。需要该 checkout 已安装 `tsx`。
- **`DSH_BIN`**：执行 `<bin> --profile sdk`，cwd 为 `DSH_WORKDIR`。

## 测试

```bash
cd packages/dsh-bridge
bun test        # 单元 + 集成（假 RCS + 假 dsh，无需 Postgres/网络）
bun run typecheck
```

`bun test` 覆盖：事件翻译、审批/提问映射、worker 信封拆包，以及用进程内假网关 + 假 dsh
驱动的完整生命周期（握手、prompt→事件、审批、提问、interrupt、resume）。

### 真实端到端（可选，不进 `bun test`）

`scripts/e2e.ts` 会拉起真 Postgres 上的真网关、真 dsh 和真模型，跑一次全链路：

```bash
cd packages/dsh-bridge

DSH_REPO=/path/to/deepseek-harness \
DEEPSEEK_API_KEY=sk-xxx \
bun run e2e
```

它会自动完成：网关 `/health` 就绪 → 桥 attached → 文本轮（`result:success`）→
bash 工具轮（`result:success`，输出校验）→ 中断（`result:aborted / Interrupted`），
最后打印 `E2E PASS`。失败时回放子进程日志并返回非零退出码。

脚本自身的环境变量：

| 变量                               | 默认                        | 说明                                    |
| ---------------------------------- | --------------------------- | --------------------------------------- |
| `DATABASE_URL` / `RCS_AUTH_SECRET` | 读 `packages/rcs/.env`      | 同名环境变量优先                        |
| `DSH_REPO` / `DSH_BIN`             | —                           | 二者至少一个                            |
| `DEEPSEEK_API_KEY`                 | 回退 `ANTHROPIC_AUTH_TOKEN` | dsh 模型凭据                            |
| `E2E_RCS_PORT`                     | `4100`                      | 网关监听端口                            |
| `E2E_RCS_API_KEY`                  | `e2e-legacy-key`            | 以网关 legacy key 注入，免建 DB api-key |
| `DSH_PROVIDER` / `DSH_MODEL`       | 同主程序                    | —                                       |
| `E2E_VERBOSE`                      | —                           | `1` 时实时打印网关日志                  |

## 结构

| 文件               | 职责                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`     | 入口：读配置、启动桥、处理信号                                                                                                        |
| `src/config.ts`    | 环境变量 → 桥配置与 dsh 启动方式                                                                                                      |
| `src/rcs.ts`       | RCS 客户端：建会话、换 worker 凭据、上报事件/状态、心跳、解析 worker SSE（会拆 `{event_id, sequence_num, event_type, payload}` 信封） |
| `src/dsh.ts`       | dsh JSON-RPC 客户端：独立进程组启动、按行分帧、反向请求兜底、停进程组                                                                 |
| `src/translate.ts` | 事件/审批/提问的双向翻译，以及 prompt 内容块转换                                                                                      |
| `src/session.ts`   | 单会话编排：轮次、审批/提问挂起与答复、interrupt/stop + resume                                                                        |

## 已知限制

- dsh 没有公开的 turn-cancel RPC。停止是杀掉整个 dsh 进程组（含工具子进程），下一条消息再
  `session/resume`；正在执行的工具会被一并终止。
- 「总是允许」只记在桥进程内存里（按 `sessionId + toolName`），桥重启后失效。
- 一轮会话对应一条 RCS 会话；多会话需要多个桥进程。
