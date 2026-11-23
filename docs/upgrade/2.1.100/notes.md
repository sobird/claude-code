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

### R19：MCP fetch 的 abort 桥接到响应体生命周期（2.1.100 #13）

`wrapFetchWithTimeout` 把传输的 `parentSignal` 桥接到每次请求的 `controller`。旧实现（v94）在响应头返回后即 `cleanup()`——`clearTimeout` 且 `removeEventListener('abort')`，于是 `controller.signal` 只覆盖到「拿到响应头」为止。但 Streamable-HTTP / SSE 的响应体是在响应头之后才流式传输的：此后若 MCP 服务器断线重连、传输层 abort 掉 `parentSignal`，正在传输的 body 已与传输信号脱钩、不会被取消，reader 继续缓冲却没有消费者，累计约 50MB/hr（2.1.100 #13）。

上游 v100（`Bc1`）改为：`parentSignal` 已 abort 时直接 `controller.abort`，否则注册 `{ once: true }` 监听并常驻到 response 生命周期；`finally` 只 `clearTimeout`，不再 `removeEventListener`。这样重连的 abort 能真正取消仍在传输的 body 并释放缓冲。移植到 `src/services/mcp/client.ts` 的 `wrapFetchWithTimeout`（外层 `if (parentSignal)` 收窄，避免断言；删掉旧的 `abort`/`cleanup` 帮助函数）。

验证：typecheck/lint + bundle 对拍（v94 成功路径 `removeEventListener`，v100 改为 `once` + `finally{clearTimeout}`）。证据：`bundle:6894457`（`Bc1` 标识符起点）、`bundle:6894848`（`{ once:!0 }` 的 `once`）。

### R20：Stop 提示词钩子长会话截断 + 评估器错误文案（2.1.98 #21/#87）

Stop / SubagentStop 的提示词钩子（prompt hook）会把整段会话 transcript 连同判定 prompt 一起交给小/快模型评估，长会话直接撑爆评估模型上下文，钩子报错而非给出判定（#21）；评估器自身返回 API 错误（如溢出）时，原实现把错误正文当模型输出送进 JSON 解析，最终只显示 `JSON validation failed`，看不出真实原因（#87）。

上游 v100（`drK`）两处改动：

1. **截断 transcript**（`nlY`）：预算 `budget = floor((has1mContext(model) ? 1e6 : 200k) * 0.7)`（`dlY=0.7`）。先 `tokenCountFromLastAPIResponse(messages) <= budget` 快判，未超则原样返回。超出时按 `CQ8` 以 assistant `message.id` 为界把消息切成「轮」（新的 assistant id 且当前轮非空即开新轮，其余消息归入其所在轮），再从最近一轮向前累加 `llY` 估算 token，保留能放进 budget 的最近若干整轮（至少保留最近一轮，向后更早的只要加上会超 budget 就停）。丢弃了前缀时在最前面插入一条说明用 `createUserMessage`，并 `logForDebugging` + `logEvent('tengu_hook_prompt_transcript_truncated', {droppedMessages, keptMessages, budget, evaluatorModel})`。
2. **评估器 API 错误**：`cleanupSignal()` 后判断 `response.isApiErrorMessage`，取 `extractTextContent(...).trim()` 作为 `non_blocking_error` 的 `stderr`（`Hook evaluator API error: …`）、`stdout:''`、`exitCode:1`，并 `logForDebugging(..., { level: 'error' })`，不再把错误正文当正常响应解析。

移植到 `src/utils/hooks/execPromptHook.ts`：引入 `groupMessagesByTurn`（CQ8）/ `estimateTurnTokens`（llY，assistant/user 用 `roughTokenCountEstimationForMessage`，其余用 `jsonStringify(m).length/4` 后 `Math.ceil`）/ `truncateStopHookTranscript`（nlY）；把 `hook.model ?? getSmallFastModel()` 提取为 `hookModel`，同时用于截断预算与 `options.model`；`messages` 非空时改为 `[...truncateStopHookTranscript(messages, hookModel), userMessage]`；在 `cleanupSignal()` 之后、正常文本提取之前插入 `isApiErrorMessage` 守卫。

差异说明：`llY` 对 attachment 等非 assistant/user 类型，上游用 `jsonStringify(message).length/4`，本仓库对 assistant/user 用 `roughTokenCountEstimationForMessage`（内部即 `roughTokenCountEstimationForContent`），语义等价；非 assistant/user 走 `jsonStringify(...)/4` 与上游一致。`evaluatorModel` 是字符串，按仓库遥测边界 `as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 收窄。

该函数依赖 `queryModelWithoutStreaming`（真实模型调用），仓库无 hook 单测；截断/分轮是纯逻辑，本轮以 typecheck/lint 与 bundle 对拍钉住，未新增单测。证据：`bundle:11670571`（`nlY` 标识符起点）、`bundle:11668445`（`drK` 内 `T.isApiErrorMessage` 标识符起点）、`bundle:11668509`（`Hooks: prompt-hook evaluator API error: ` 字面量）。

### R21：后台子代理失败时上报部分进度（2.1.100 #86）

后台子代理在运行中抛错进入 failed 分支时，原实现只把错误文本报给父代理，失败前已产出的 assistant 文本被丢弃；只有用户取消（killed）分支带了 `finalMessage: extractPartialResult(agentMessages)`（2.1.100 #86）。

上游 v100 后台代理生命周期（`Wx8` 系列）的 failed `enqueueAgentNotification` 补上 `finalMessage: o88(agentMessages)`，其中 `o88` 即 `extractPartialResult`（从末尾向前找第一条非空 assistant 文本）。任务通知消费端 `enqueueAgentNotification` 的 `resultSection` 对任意 status 都渲染 `<result>…</result>`，因此 failed 通知带上 finalMessage 后父代理即可看到部分进度。

本仓库这段生命周期被复制到两处，均需同步：`src/tools/AgentTool/AgentTool.tsx`（内联 async-from-start 路径）与 `src/tools/AgentTool/agentToolUtils.ts`（`runAsyncAgentLifecycle`，async-from-start 与 `resumeAgentBackground` 共用）。两处 failed 分支各自补 `finalMessage: extractPartialResult(agentMessages)`（`extractPartialResult` 已在 killed 分支与文件内使用，无需新导入）。

差异：上游是单一函数，仓库因历史拆分有两份同构实现；两处等价修改，行为与上游一致。无针对该错误分支的现成单测（依赖真实后台 agent 生命周期），本轮以 typecheck/lint 与 bundle 对拍钉住。证据：`bundle:7526435`（v100 failed 通知里的 `o88(J)` 标识符起点）、`bundle:7524741`（`o88` 即 extractPartialResult 定义处）；v94 同位置 failed 分支无 `finalMessage`（对拍确认）。

### R22：OTEL 交互 span 并发隔离 + headless 按 turn 结束（2.1.100 #99）

两处改进：① 并发 SDK 调用下 interaction span 应正确包住整个 turn；② headless（print/SDK）的每个 turn 各自结束 span（此前 span 只在进程 shutdown 时结束，一个 span 横跨所有 turn）。

上游 v100 新增帮助函数 `Ib8(prompt, fn)`：

```js
function Ib8(q, K) {
  dvz(q) // startInteractionSpan(prompt)
  let _ = cd.getStore() // 刚 enterWith 进去的 store
  try {
    return cd.run(_, K)
  } finally {
    // 用 AsyncLocalStorage.run 把 store 绑定到 K 的异步树
    if (cd.getStore() === _) cd.enterWith(void 0)
  } // 仅当仍持有才清
}
```

关键点：`run()` 把 store 作用域限定到该 turn 的异步树并在返回后恢复调用方 store，因此并发 turn 各持独立 context，不再像 `enterWith` 那样抢占/覆盖共享槽；`finally` 的 `getStore()===_` 守卫避免误清一个已被并发 turn 接管的 store。两处调用：interactive 的 handlePromptSubmit 把「processUserInput 循环 + onQuery」整个 turn 包进 `Ib8`，并在回调 finally 调 `ld()`（=endInteractionSpan）；headless 的 print 循环把单轮 `ask()` 迭代包进 `Ib8`，同样 finally 调 `ld()`。相应地把 `startInteractionSpan` 从 processTextPrompt 移除，改由 wrapper 统一启动（v100 中 `dvz` 仅由 `Ib8` 调用）。

移植：

- `src/utils/telemetry/sessionTracing.ts` 新增 `runWithInteractionSpan<T>(prompt, fn)`（`Ib8` 等价：start + `interactionContext.run(getStore(), fn)` + 条件清除）。
- `src/utils/handlePromptSubmit.ts` / `src/cli/print.ts`：在既有 `runWithWorkload` 的 turn 体外再包一层 `runWithInteractionSpan(interactionPromptText, async () => { try { ...原 turn 体... } finally { endInteractionSpan() } })`；prompt 文本取首个输入的字符串或 `extractTextContent(input, '\n')`，与 v100 的 `Ib8` 实参一致。
- `src/utils/processUserInput/processTextPrompt.ts`：删除 `startInteractionSpan` 调用与 import。

差异：v100 在 interactive 的 Ib8 回调末尾（无消息分支与 finally）调 `ld()`；本仓库 interactive 的 endInteractionSpan 原在 REPL.resetLoadingState 中按 turn 调用，现新增在外层 wrapper 的 finally 调一次，二者幂等（span.ended 守卫），不重复结束同一 span。QueryEngine（in-process SDK / cowork，`querySource:'sdk'`）在 v100 下同样不再经 processTextPrompt 启动 span（上游只在那 2 个 Ib8 点启动），本移植保持一致。

验证：typecheck/lint/fmt:check 通过；headless E2E（tests/e2e/print-chain.test.ts、hooks.test.ts，共 11 例）与 interactive E2E（interactive.test.ts，1 例）全绿，证明包住 turn 后交互与无头两种执行都不受影响。证据：`bundle:7051653`（`Ib8` 定义，标识符起点）、`bundle:12409639` / `bundle:13248687`（interactive / headless 两处 `Ib8` 调用，标识符起点）。

### R23：Remote Control 权限处理器条目泄漏（上游 #85）

Remote Control 交互式权限里，`handleInteractivePermission` 通过 `bridgeCallbacks.onResponse(requestId, handler)` 把 handler 注册进 `useReplBridge` 的 `pendingPermissionHandlers` Map（`bridgeRequestId` 为 key）。v94 中该退订函数是块内 `const unsubscribe`，只被当作 abort 监听器注册：`signal.addEventListener('abort', unsubscribe, { once: true })`。于是除 CCR 主动回复（`handlePermissionResponse` 先 `delete` 再回调）和会话 abort 外，**任何本地获胜路径都不会删除该条目**——用户本地允许/拒绝、hook 判定、classifier 自动放行都只调 `bridgeCallbacks.cancelRequest` 通知对端关闭提示，但没调退订，Map 条目（连同其闭包与 abort 监听器）一直留到会话结束（上游 #85）。

上游 v100（`Iq5`）把退订函数提升到函数外层变量 `W`，在每个本地获胜点与 bridge 回复处理里 `W?.()`，从而删除条目；同时 channel 通道的退订（重命名 `D`）与 bridge 的 `W` 在每个获胜点成对调用（例如 onAbort 的 `W?.(),D?.()`）。移植到 `src/hooks/toolPermission/handlers/interactiveHandler.ts`：

- 新增 hoisted `let bridgeUnsubscribe: (() => void) | undefined`。
- bridge 块按下方 channel 块同样的方式包装：`bridgeUnsubscribe = () => { unsubscribe(); signal.removeEventListener('abort', bridgeUnsubscribe!) }`，并以它作为 abort 监听器；bridge 回复处理里改调 `bridgeUnsubscribe?.()`（`onResponse` 已由 `handlePermissionResponse` 先 `delete`，`Map.delete` 幂等）。
- 各本地获胜点（`onAbort` / `onAllow` / `onReject` / `recheckPermission`、channel 回复处理、hook 分支、classifier `onAllow`）在既有 `channelUnsubscribe?.()` 旁补 `bridgeUnsubscribe?.()`。

`useReplBridge.handlePermissionResponse` 不动：CCR 回复路径仍是「取 handler → delete → 回调」，删条目在前。该桥接/权限子系统在外部 bundle 里被 tree-shaking 部分裁剪（classifier 分支不在 bundle 内），无法用 probe 驱动，本轮以 typecheck/lint/fmt + bundle 对拍钉住；证据 `bundle:12392576`（提升后的 `W=O.onResponse(P,…)` 赋值，标识符起点）、`bundle:12391504`（onAbort 的 `W?.(),D?.()` 双退订，标识符起点）。无既有单测覆盖 `handleInteractivePermission`（未导出、强依赖 React/ctx），故未新增测试。
