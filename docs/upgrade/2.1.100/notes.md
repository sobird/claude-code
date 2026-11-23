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
| `env:`  | −CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT | removed           | 随 #19/#20 同步下线；见 R16 |
| `flag:` | 无差异                                    | —                 | 94→100 cliFlags 集合相同    |

`verify`（不带 `--release-notes`）已 `ok=true`。另 5 条 `approximated` env 是依赖噪声 / resume 提示阈值 / 扫描器子串噪声，按 2.1.94 台账原样延续（见 R2）。

## R 条目

### R1：上游移除、本仓库有意保留（retained-internal）

- `cmd:buddy`：上游 2.1.100 不再注册 buddy 命令；本仓库保留 `src/commands/buddy`。
- `env:CLAUDE_CODE_REPL`：上游移除；`src/tools/REPLTool/constants.ts` 仍以它作为 REPL 工具前提。

`env:CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT` 原先也登记在这里（仅 `isLoggableMessage` 读取）。R16 把该函数改成上游 2.1.97 的黑名单形态后，它不再有任何读取点，故随上游一并移除，登记条目已删除。

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

### R10：release 覆盖批次二（UI/终端项分类）

未覆盖项 38 → 16，均为手写实现差异，统一登记 `approximated` 并写明原因：NO_FLICKER/fullscreen 终端项（#2/#27/#29/#30/#31/#32/#33）、终端键盘/Unicode（#63/#64）、rate-limit upsell 可见性（#16/#81）、context-low footer 通知（#42）、markdown 引用竖线（#43）、图片压缩预算（#38）、CJK 补全触发（#39）、bridge 会话卡片（#40）、VSCode git-bash（#102）、语音输入（#83）、反馈调查（#88）、/resume 筛选提示（#92）、Vim NORMAL 历史（#97）、Cedar 高亮（#6）。

剩余 16 条为需真实移植的核心行为：MCP 缓冲 #13、transcript 持久化/大小 #18/#19/#20/#44/#76、hooks 长会话 #21/#87、compaction 重复文件 #23、plugin update #24、流式回落 #60、/effort max #79、Remote Control 句柄泄漏 #85、后台子代理部分进度 #86、hook stderr #98、OTEL 交互 span #99。

### R11：`/effort max` 对未知模型放行（2.1.96 #79）

旧逻辑 `modelSupportsMaxEffort` 仅在模型名含 `opus-4-6`（或 ant 模型）时返回 true，其余一律 false，导致未知/未来模型的 `max` 被 `resolveAppliedEffort` 降级为 `high`。上游改为 denylist 语义：先 `normalizeMaxEffortModel` 归一化（取首个 `claude-*` token，去 `-vN[:M]`、`-YYYYMMDD` 后缀），`haiku` 直接 false，其余仅命中遗留模型 denylist 才 false，未知/未来模型默认放行。已按上游常量 `MAX_EFFORT_DENYLIST` 移植并加测试。

### R12：hook 错误显示 stderr 首行（2.1.98 #98）

transcript 里 `hook_non_blocking_error` 原本只显示「{hook} hook error」，完整输出只进 debug 日志。上游 `vzY` 取 stderr（空则 stdout）首行、截掉 `Expected schema:` 之后、超 200 字符加省略号，作为第二行显示。移植为 `AttachmentMessage.getHookErrorFirstLine`，测试 `src/components/messages/__tests__/getHookErrorFirstLine.test.ts`。

### R13：`claude plugin update` 先刷新 git marketplace（2.1.97 #24）

对 git / github / url 来源的 marketplace，`updatePluginOp` 在计算新版本前先拉取一次本地 clone —— 否则陈旧的 `rev-parse HEAD` 会让 update 误报「already at the latest version」，即便远端已有新提交（2.1.97 修复）。

上游 `XI6` 在 `getPluginById` 之前读 `loadKnownMarketplacesConfig()[marketplace].source`，仅当 `source=='github'|'git'|'url'` 时 `await refreshMarketplace(name, undefined, {skipIfRecent:true})`，失败吞掉并 `warn` 回退缓存。`refreshMarketplace` 新增 `skipIfRecent`：`lastUpdated` 在 30s 内直接 return，避免 autoupdate 路径已刷新后的重复拉取。

移植到 `src/services/plugins/pluginOperations.ts`（`updatePluginOp`）与 `src/utils/plugins/marketplaceManager.ts`（`refreshMarketplace` 的 `skipIfRecent`）。该子系统无现成单测（读写真实 marketplace/fs），本轮以 typecheck/lint 与 bundle 对拍钉住语义；证据 `bundle:10759856`（update 前置刷新块）、`bundle:9837254`（skipIfRecent 跳过日志）。

### R14：卡住的流式回落非流式（2.1.98 #60）

上游 v94 的 catch 分支里，SDK 抛 `APIUserAbortError` 且我们的 signal 未中止时无条件 `throw APIConnectionTimeoutError('Request timed out')`，于是 idle watchdog 触发的卡住被当作可重试超时，走了 withRetry 超时而不是回落非流式。

2.1.98 的两处改动（`v100` 的 catch）：① 该 throw 加守卫 `else if(!streamIdleAborted)` —— watchdog 已 fire 时不再抛超时，落到下面的回落分支；② 计算 `$1 = streamIdleAborted ? Error('Stream idle timeout - no chunks received') : E8`，用于日志文案、`tengu_streaming_fallback_to_non_streaming` 的 `error` 名，以及 `fallback_disabled` 为真时的 `throw`（此时抛出的是 idle-timeout 错误而非原始超时）。

移植到 `src/services/api/claude.ts`：`else if (!streamIdleAborted)`；新增 `fallbackError`，disableFallback 日志/throw 与回落日志/事件统一改用 `fallbackError`。该生成器依赖真实 SDK 流、无现成单测，本轮以 typecheck/lint 与 bundle 对拍钉住；证据 `bundle:11797553`（`$1=E6?Error("Stream idle timeout…")`）、`bundle:11797289`（`Streaming timeout (SDK abort)` 守卫处）。

### R15：缩小 transcript（2.1.98 #44）

两处改动合并为「session transcript 体积」条目：

- `isLoggableMessage`（上游 `QM6`）在 `progress` 过滤之后新增：`hook_success` 附件的 `content`、`stdout.trim()`、`stderr.trim()` 全为空则不入账——空 hook 结果只占行数。
- 写 transcript 前对 user 消息的 `toolUseResult` 调 `capStoredPreEditFileCopy`（上游 `jyK`）：`originalFile` 是字符串且长度 > `1e4`（`SZY`）时置为 `null`。Edit/Write 结果带整份原文，几次大文件编辑就会主导 JSONL；截断会渲染半个文件，所以丢成 null。
- 上游同一区域还有 tools 的 `stripForStorage` 钩子与 `HyK`（仅对最近 `_=200` 条之外的消息裁剪内存里的 `toolUseResult`）——那属于会话内存而非落盘大小，未纳入本条目；如后续做 UI 大文件 diff（#18/#76）再评估。

测试：`src/utils/__tests__/transcriptStorageCap.test.ts`。证据：`bundle:9902098`（空 hook_success 判断）、`bundle:9945880`（`originalFile.length>SZY`）、`bundle:11588253`（`insertMessageChain` 里 `X.toolUseResult=jyK(...)` 调用点）。

### R16：外部用户附件默认落盘（2.1.97 #19/#20）

`isLoggableMessage`（上游 v94 `MX6` → v98/v100 `QM6`）对非 ant 用户的附件过滤从「白名单」改为「黑名单」。v94 只放行 `hook_additional_context`（且需 `CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT`）、`hook_deferred_tool`、若干 `*_delta`、`skill_listing` 等少数类型，其余附件一律丢弃；`queued_command`——承载「Claude 工作时用户中途敲入的输入」——正在丢弃之列，于是这些消息不落 transcript，`--resume` 后丢失（2.1.97 #19/#20）。

v98/v100 改为默认全落盘，仅排除显式列出的类型（黑名单 `KlY=new Set([])`，当前为空集）。移植为 `NON_ANT_ATTACHMENT_DENYLIST`（空集）+ `isLoggableMessage` 的黑名单判断；互动（`useLogMessages`/REPL）与 SDK（`QueryEngine`）两条 transcript 写入路径都经 `cleanMessagesForLogging→isLoggableMessage`，故一处修改同时覆盖。

`CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT` 原先只在旧白名单分支读取；改成黑名单后失去唯一读取点，随上游一并移除（inventory 差异登记 `removed`，台账条目删除，见 R1）。

测试：`src/utils/__tests__/transcriptStorageCap.test.ts`（external 用户下 `queued_command` 落盘、空/非空 `hook_success` 仍按 #44 规则过滤）。证据：`bundle:11617350`（`QM6` 标识符起点）、`bundle:11627130`（`KlY=new Set([])` 黑名单）。

### R17：`--resume` 后大文件编辑 diff 恢复显示（#18 / #76）

#44（R15）在落盘时把 Edit/Write 结果中 >10KB 的 `originalFile` 置 null 以压 transcript 体积。`--resume` 回放该 tool_result 时，`src/tools/FileEditTool/UI.tsx` 的 `renderToolResultMessage` 直接 `originalFile.split('\n')[0]`，对 null 抛错（或整块空白），编辑 diff 消失（2.1.96 #18 报告，2.1.100 #76 复修）。

上游 v100（`fc4`）把该渲染改为 `firstLine: _ ? DO(_) : null, fileContent: _ || void 0`——缺 `originalFile` 时 `firstLine=null`、`fileContent=undefined`，由始终落盘的 `structuredPatch` 渲染 diff。移植：`firstLine={originalFile ? firstLineOf(originalFile) : null}`、`fileContent={originalFile || undefined}`（`firstLineOf` 即上游 `DO`）。`originalFile` 的 zod 契约仍为 `string`，运行时 null 由真值守卫兼容，无需断言。Write 侧渲染本就用 `content` 取 firstLine、`fileContent ?? undefined`，不受影响。

验证：typecheck/lint + bundle 对拍（`fc4` 守卫）。证据：`bundle:7278514`（`firstLine` 守卫）、`bundle:7278537`（`fileContent` 回落）。

### R18：compaction 不再重复写子代理 transcript（2.1.100 #23）

compaction 的摘要走 prompt-cache 共享分支：`streamCompactSummary` 用 `runForkedAgent` 起一个 fork 子代理，`forkContextMessages` 是整段（可能数 MB 的）被压缩对话。`runForkedAgent` 默认给每次 fork 生成新 `agentId` 并把初始消息链写进 `<session>/subagents/agent-<agentId>.jsonl`。prompt-too-long 时压缩会重试，每次重试都新建 fork、新 agentId，于是每轮重试都落下一份重复的多 MB 子代理 transcript（2.1.100 #23）。

上游 v100（`DkK`）给该 fork 调用加 `skipTranscript: !0`。`runForkedAgent` 早已支持该开关（置位时不建 agentId、不做任何 transcript I/O），其余一次性 fork（taskSummary/agentSummary 等）也都这样。移植：在 `src/services/compact/compact.ts` 的 `streamCompactSummary` 里 `skipCacheWrite: true` 后加 `skipTranscript: true`。一处改动覆盖 proactive autoCompact、reactiveCompact 与 `/compact`（都经 `compactConversation`→本函数）。

注意：v100 同处还多了 `maxOutputTokens: Math.min(...)`，那是另一项上游改动；本仓库该分支明确注释「不设 maxOutputTokens」以保持与主线程 prompt-cache 对齐（compact.ts:1050-1056），未一并移植。

验证：typecheck/lint + bundle 对拍（v94 无、v100 有 `skipTranscript:!0`）。证据：`bundle:9679412`（`skipTranscript` 标识符起点，位于 `DkK` 内）。
