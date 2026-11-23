# 2.1.94 → 2.1.100 升级记录

对照基线：2.1.94（`/tmp/up2100/v94/package/cli.js`）→ 2.1.100（`/tmp/up2100/v100/package/cli.js`）。

## 台账闭合（inventory 客观差异）

三份 inventory（94 / 98 / 100）直接对拍得到的差异全部登记完毕：

| 面向    | 差异                                      | 状态              | 说明                        |
| ------- | ----------------------------------------- | ----------------- | --------------------------- |
| `cmd:`  | +setup-vertex                             | ported            | 登录页 Vertex 向导；见 R3   |
| `cmd:`  | −buddy                                    | retained-internal | 上游移除，本仓库保留；见 R1 |
| `env:`  | +CLAUDE_CODE_MAX_CONTEXT_TOKENS           | already-present   | src 早已支持                |
| `env:`  | +CLAUDE_CODE_PERFORCE_MODE                | already-present   | src 早有 PERFORCE 只读保护  |
| `env:`  | +CLAUDE_CODE_SCRIPT_CAPS                  | already-present   | src 早有 SCRIPT_CAPS        |
| `env:`  | −CLAUDE_CODE_REPL                         | retained-internal | src 仍有 REPLTool；见 R1    |
| `env:`  | −CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT | retained-internal | src 仍用它落盘；见 R1       |
| `flag:` | 无差异                                    | —                 | 94→100 cliFlags 集合相同    |

`verify`（不带 `--release-notes`）已 `ok=true`。另 5 条 `approximated` env 是依赖噪声 / resume 提示阈值 / 扫描器子串噪声，按 2.1.94 台账原样延续（见 R2）。

## R 条目

### R1：上游移除、本仓库有意保留（retained-internal）

- `cmd:buddy`：上游 2.1.100 不再注册 buddy 命令；本仓库保留 `src/commands/buddy`。
- `env:CLAUDE_CODE_REPL`：上游移除；`src/tools/REPLTool/constants.ts` 仍以它作为 REPL 工具前提。
- `env:CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT`：上游移除；`src/utils/sessionStorage.ts` 仍用它控制 hook additionalContext 落盘。

跟进：若后续决定跟随上游下线 REPL / buddy，再分别删除并改台账，不要为过 `verify` 反向删代码。

### R2：依赖噪声 / 无对应实现的 env（approximated）

- `CLAUDE_CODE_HOST_HTTP_PROXY_PORT` / `CLAUDE_CODE_HOST_SOCKS_PROXY_PORT`：打包依赖 `@anthropic-ai/sandbox-runtime` 注入，src 不直接读取。
- `CLAUDE_CODE_RESUME_THRESHOLD_MINUTES` / `CLAUDE_CODE_RESUME_TOKEN_THRESHOLD`：上游 resume-return 提示阈值，本仓库无此提示。
- `CLAUDE_CODE_SM_COMPACT`：扫描器 `ENV_RE` 从 `ENABLE_/DISABLE_CLAUDE_CODE_SM_COMPACT` 截出的子串名，真实读取点带前缀（扫描噪声）。

### R3：Vertex 向导的 relaunch

`src/utils/cliLaunch.ts` 新增 `execRelaunch()`（`node:os` 的 `constants`），向导完成先写配置再重启进程进入正常登录流程。与上游行为一致；无 source map 下对齐置信度 medium。

### R4：Monitor 工具

上游 2.1.98 新增 Monitor 工具（后台脚本流式事件）。本仓库改为 `src/tools/MonitorTool/MonitorTool.tsx`：每行 stdout 视为一个事件通知，令牌桶 10/2s、200ms 批聚合、支持 timeout/persistent，权限走 `bashToolHasPermission`。旧的 MCP-watching 版 `MonitorTool.ts` 与 `MonitorPermissionRequest` 已删除，权限 UI 复用 `BashPermissionRequest`。

### R5：安全修复（2.1.97 #7、2.1.98 #9/#12/#22/#24/#42 等）

已按 TDD 移植并有测试钉住：

- `/dev/tcp`、`/dev/udp` 网络设备重定向识别并强制询问（`src/utils/bash/commands.ts`、`pathValidation.ts`）。
- Bash 通配 / 前缀规则空白归一化，`git  commit` / tab 也能命中（`shellRuleMatching.ts`、`bashPermissions.ts`、`BashTool.tsx`）。
- `grep -f FILE` / `rg -f FILE` 模式文件纳入工作目录路径校验（`pathValidation.ts`）。
- `cut -d /`、`paste -d /`、`column -s /` 的值按取值跳过，`awk '{print $1}'` 跳过程序体并把 `-f` 程序文件纳入校验（`filterOutFlagsWithValues`、awk 提取器，`pathValidation.ts`）。
- 写保护路径获批后不再悄悄降级会话模式：Bash 路径检查器只在 default/plan 下建议 `setMode:acceptEdits`。
- 权限规则名与 `Object.prototype` 属性同名（`toString`）时不再让 settings.json 规则被静默忽略（`Object.hasOwn` 查表）。
- 反斜杠转义空白、环境变量前缀等其余条目在 src 中已具备（backslash guard、safe env 白名单、Map 规则聚合）。
- 复合 Bash 命令在 auto / bypass 模式下不再绕过强制询问（2.1.98 #57）：`hasAskRuleDecision` / `hasSafetyCheck` 递归进 `subcommandResults`，多子命令同时触发 ask/safety 时依然命中 1f/1g，bypass 不会在 2a 直接放行。
- 带 worktree 隔离或 `cwd:` 覆盖的子代理不再把 `cd` 泄漏回父会话（2.1.98 #22）：`src/utils/cwd.ts` 的 ALS 存储改为可变 `{cwd}`，`setCwdForCurrentContext` 在覆盖内只改本地、覆盖外才写全局；`Shell` 的默认 cwd 变更只在非覆盖上下文更新 session env 缓存与 CwdChanged hook。
- 陈旧子代理 worktree 清理把未跟踪文件也算作改动（2.1.98 #90）：去掉 `git status --porcelain` 的 `-uno`，含未跟踪文件的残留 worktree 不再被 `--force` 删除。

### R6：设置会话内生效（2.1.98 #20/#21、2.1.98 #10 / 2.1.100 #66）

`applySettingsChange` 在重放磁盘规则后调用新增的 `reconcileAdditionalDirectories`：

- `permissions.additionalDirectories` 的会话内变更即时生效——移除的目录立即失权、新增的无需重启（2.1.98 #20 / 2.1.100 #67）。
- 由 `--add-dir` / `/add-dir` / 会话（`cliArg` / `command` / `session`）授予的同名目录不被设置编辑收回（2.1.98 #21 / 2.1.100 #68）。
- 目录先按 `resolve(expandPath(x))` 归一化再比对，`~` 与相对路径不会误判为增删。

`syncPermissionRulesFromDisk` 的清理循环覆盖全部五个规则来源（user/project/local/flag/policy），与上游 `tf` 一致。旧实现只清三处磁盘来源，导致管理员移除的 managed（policy）允许规则在 policy 组清空后残留到进程重启（2.1.98 #10 / 2.1.100 #66）；现在组清空时也会被显式清掉。

测试：`src/utils/settings/__tests__/reconcileAdditionalDirectories.test.ts`、`src/utils/permissions/__tests__/syncPermissionRulesFromDisk.test.ts`。

### R7：release 说明覆盖

2.1.96 / 2.1.97 / 2.1.98 的逐条覆盖（`releaseItems`）在台账中按条推进；2.1.100 自身 release notes 为空。未覆盖项以 `verify --release-notes` 的 `uncoveredReleaseItems` 为准逐一补齐，UI/无 flicker/终端专属项按 `approximated` 或 `ignored-dependency` 记录原因。

### R8：状态行扩展（2.1.96 #3、2.1.98 #4/#53）

- `statusLine.refreshInterval`（`z.number().min(1)`）：设置后 `StatusLine` 用 `setInterval(max(1,N)*1000)` 额外触发一次 `doUpdate`，与事件驱动更新并存。
- `workspace.git_worktree`：当前目录位于 linked git worktree 时填该 worktree 名。复用 `src/utils/git/gitFilesystem.ts` 的 `resolveGitDir`，新增 `getGitWorktreeName`（普通仓库 gitdir 的 basename 为 `.git` → null；仅 `<common>/worktrees/<name>` 取 `<name>`），测试见 `src/utils/git/__tests__/getGitWorktreeName.test.ts`。
- 已存在、仅登记 `releaseItems` 的下游项：OTEL `TRACEPARENT`（#46/#54）、LSP `clientInfo`（#55）、print `--exclude-dynamic-system-prompt-sections`（#52）。

### R9：release 覆盖批次一（安全/权限 already-present + 跨版本重复合并）

`verify --release-notes` 未覆盖项 75 → 38。本批：

- `already-present`（src 已有，只登记）：Bash 权限加固 #8/#35/#56/#58/#70/#96；429 Retry-After 退避 #15/#61；MCP OAuth metadata 刷新 #14/#62；Bedrock 空串认证 #1/#34；`DISABLE_COMPACT` 去掉提示 #104；`/export` #78；`/reload-plugins` #95；MCP `maxResultSizeChars` #82；`DISABLE_AUTOUPDATER` #84；transcript 最终 token 用量 #45/#100。
- `ignored-dependency`：`sandbox.network.allowMachLookup` #37/#91（sandbox-runtime 依赖实现）。
- `approximated`（手写实现差异，未逐条对拍）：插件 frontmatter 布尔名 #25/#80；`/resume` 选择器 UI #17/#77；NO_FLICKER 复制 URL / MCP 悬停 #26/#28/#74/#75；footer 指示器布局 #41/#93；`/agents` Running tab #5/#94；`/claude-api` skill Managed Agents #47/#101；沙箱网络自动批准 #36；teammates 权限继承 #73。

剩余 38 条（核心行为移植 + 其它 transcript/UI 项）留待批次二。
