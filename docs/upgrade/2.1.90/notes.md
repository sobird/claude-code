# 2.1.90 近似实现与未解点

台账：`docs/upgrade/2.1.90/status.json`（reference 2.1.89 → target 2.1.90）。产物位于 `/tmp/upgrade-2.1.90/`：`package/cli.js`（2.1.90）、`ref-2.1.89/package/cli.js`（2.1.89）、`work/inventory-2.1.90.json`、`work/align-2.1.90/align.json`、`work/candidates-2.1.90/`。文中偏移均为解码后字符偏移。

## 增量范围

inventory 对拍（2.1.89 → 2.1.90）只有以下差异，CLI flag 无变化：

- 命令：`powerup`（local-jsx）、`toggle-memory`（local）
- `CLAUDE_CODE_*`：`CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE`、`CLAUDE_CODE_USE_ANTHROPIC_AWS`、`CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH`
- 非 `CLAUDE_CODE_` 环境的 AnthropicAws 变量：`ANTHROPIC_AWS_API_KEY` / `ANTHROPIC_AWS_BASE_URL` / `ANTHROPIC_AWS_WORKSPACE_ID`
- 行为：Claude Platform on AWS provider、extractMemories 的 prose 跳过与 “Nothing to save.” 指令、/help 中的 /powerup 提示

## 近似实现

### /toggle-memory（R1、R4）

- 依据：注册 `type:"local",name:"toggle-memory",description:"Toggle automemory off/on for this session",isEnabled:()=>!1` @10094714；状态切换与提示文案 @10094281–10094376。
- R1：上游随灰度默认 `isEnabled:()=>false`（命令不可见）。经用户确认，本仓库去掉该门控，让开关可用；`isHidden:false`、`supportsNonInteractive:false` 与文案保持上游。
- R4：上游把开关状态传给记忆子系统；本仓库近似为进程内会话状态 `STATE.memoryToggledOff`（不落盘、新会话自动恢复）：
  - `src/bootstrap/state.ts`：`getMemoryToggledOff` / `setMemoryToggledOff`
  - `src/utils/permissions/filesystem.ts`：读写 automemory 路径直接 deny（必须先于 project-dir 放行判定）
  - `src/services/extractMemories/extractMemories.ts`：`createAutoMemTool` 一律拒绝，避免 fork 子代理绕过
  - 测试：`src/commands/toggle-memory/__tests__/toggle-memory.test.ts`、`src/services/extractMemories/__tests__/autoMemoryToggle.test.ts`、`src/utils/permissions/__tests__/autoMemoryToggle.test.ts`

### /powerup（R2、R3）

- 依据：注册 `type:"local-jsx",name:"powerup",description:"Discover Claude Code features through quick interactive lessons"` @10482754；事件 `tengu_powerup_lesson_opened` @10478615、`tengu_powerup_lesson_completed` @10478879；进度键 `powerupsUnlocked` @10478848。
- 已完成态持久化到 global config 的 `powerupsUnlocked: string[]`（`src/utils/config.ts`）。
- R2：上游事件带字符串 `lesson_id`；仓库 `logEvent` 元数据类型不接受字符串，改发 `lesson_index`（数字）。事件名不变。
- R3：全部 lesson 完成时的庆祝动画（confetti/ASCII 烟花）未移植；完成状态与进度比率照常渲染。
- 测试：`src/commands/powerup/__tests__/powerup.test.ts`。

### /help 的 /powerup 提示

- 依据：`"New here? Run "` @10101923、`" to learn the features most people miss."` @10102006、行数阈值 `BXY=44` @10102425。
- `src/components/HelpV2/General.tsx`：终端 `rows >= 44` 时显示提示，颜色 `suggestion`，与上游一致。

### extractMemories prose 跳过

- 依据：`"[extractMemories] skipping — no user prose since last extraction"` @9425792、`tengu_extract_memories_skipped_no_prose` @9425902、提示词句尾 `"If nothing is worth saving, output only 'Nothing to save.' Do not explain why."` @9422558。
- `hasUserProseSince` 判定：非 meta 用户消息、文本 ≥3 词；游标丢失（压缩）时回退为「整段消息里是否有 prose」，与上游「找不到游标则不因缺失而跳过」一致。跳过时把 `lastMemoryMessageUuid` 推进到最新消息，避免下轮重复扫描。
- 测试：`src/services/extractMemories/__tests__/autoMemoryToggle.test.ts`。

### Claude Platform on AWS（R5）

- 依据（bundle 内 `AnthropicAws` 类 @≈2979470–2982000）：
  - service 名 `aws-external-anthropic` @2980667；默认 base `https://aws-external-anthropic.<region>.api.aws` @2981064
  - `No AWS region or base URL found…` @2981133；`No workspace ID found…` @2981646
  - `anthropic-workspace-id` 默认头 @2981819；`ANTHROPIC_AWS_API_KEY` @2981547、`ANTHROPIC_AWS_BASE_URL` @2981026、`ANTHROPIC_AWS_WORKSPACE_ID` @2981593
  - client 分支：`CLAUDE_CODE_USE_ANTHROPIC_AWS` @3434722、`CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH` @3434848
- R5：本仓库 `@anthropic-ai/sdk@0.81.0` 没有 `AnthropicAws` 类，`@smithy/signature-v4` 也不是直接依赖（仅在 `.bun` 虚拟商店里作为传递依赖）。因此新增 `src/services/api/anthropicAws.ts`：
  - 用 `node:crypto` 手写 SigV4（canonical request / canonical URI / canonical query / HMAC 派生、`x-amz-date`、可选 `x-amz-security-token`），以 fetch 包装器在每次请求（含 SDK 重试）重新签名。
  - 不可哈希的 body 回退为 `UNSIGNED-PAYLOAD` 并打 debug 日志（上游 smithy 亦按 streaming 处理，语义近似）。
  - 凭据顺序与上游一致：显式 key 对 → `providerChainResolver` → `@aws-sdk/credential-providers` 的 `fromNodeProviderChain`（动态 import，失败时保留上游错误文案并附带 `cause`）。
  - 上游类 `extends` SDK 并覆写 `validateHeaders(){}`、`authHeaders()`；裸 client 无法覆写，改用 SDK 支持的等价逃生口：SigV4 路径注入 `defaultHeaders: { authorization: null }`，让 SDK 视为「显式省略」而不强制 apiKey/authToken，签名头随后由 fetch 包装器写入。无此处理时首个请求会抛 “Could not resolve authentication method”。
  - API key 路径（未启用 SigV4）不再吞掉调用方传入的 `fetch`（修复测试暴露的问题）。
- provider 面：`APIProvider` 增加 `anthropicAws`，探测顺序 bedrock→foundry→anthropicAws→vertex→firstParty；新增 `isFirstPartyLikeProvider()`（firstParty ∪ anthropicAws）与 `shouldAttachClientRequestId()`。按 2.1.90 语义，模型默认值/选择、betas、effort、thinking、WebSearch、请求 id、billing header（不发 `cch`）视同 firstParty；OAuth/Claude.ai 服务、迁移、fast mode、pricing 后缀等仍仅 firstParty。
- 未做端到端真实 AWS 调用（无凭据/网络）：签名正确性由单测固定（`src/services/api/__tests__/anthropicAws.test.ts`，含 scope、session token、workspace 头、API key 路径与 env 缺省），配置错误路径全覆盖。

### marketplace 保活变量（R7）

- 依据：`CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE` @9633277。
- `src/utils/plugins/marketplaceManager.ts`：`git pull` 失败且变量为真时保留现有克隆并 debug 日志返回，不再清空重克隆。
- R7：`cacheMarketplaceFromGit` 依赖真实 git 仓库与失败注入，未加单测；静态偏移为验收证据。

## 字符串级 triage 与补充移植（R8–R12）

inventory/align 只覆盖命令、环境变量与 flag。为确认「完整升级」，另对 2.1.90 新增/变更的 193 条可读字符串逐条 triage，归类如下。

### 打包依赖内部（R8，不移植）

proxy-agent、axios、ajv、debug、`@smithy/*`、`@aws-sdk/*`、GrowthBook SDK、`@anthropic-ai/sandbox-runtime`、PowerShell AST 解析器内部字符串等，属于第三方依赖的实现细节，`src/` 不直接拥有。

### 本仓库自研 RCS/bridge（R9，不移植）

`[bridge:repl]` 持久化同步、`CCR v2 internal event writer cleared` 等属于上游 bridge 的 CCR v2 事件写入器。本仓库 bridge/RCS 为自研实现，没有对应写入器，强行移植会引入死代码。

### 有上游功能前提、但本仓库缺该功能（R10，文档化不移植）

- `/resume` 的 `sessionKind` / `entrypoint` / `isLoopSession` 过滤：本仓库没有 `/loop` 与会话元数据，过滤条件无从落地。
- auto-mode classifier 的 Environment 模板 `- **Trusted repo**` / `- **Source control**`：`yolo-classifier-prompts/*.txt` 在本仓库是 0 字节占位，classifier 未实装。
- security-monitor system prompt：本仓库无此功能。

以上条目如实记录为「未移植」，不伪造实现。

### 真实 CLI 增量（R11，已移植）

- PostToolUse 后 readFileState re-sync（`src/services/tools/postToolUseFileResync.ts`，接入 `toolExecution.ts`）：`bundle:9364565`/`9364609`/`9364726`；测试 `src/services/tools/__tests__/postToolUseFileResync.test.ts`。
- PowerShell `Remove-Item -Recurse` 工作目录守卫（`pathValidation.ts`）：`bundle:8612433`；测试 `src/tools/PowerShellTool/__tests__/pathValidation.test.ts`。守卫只放在主命令循环，与上游一致（R12：嵌套控制流命令不额外加守卫）。
- PowerShell 后台作业检测（`parser.ts` 的 `PipelineBaseAst.Background` → `hasBackgroundJob`，权限层强制 ask）：`bundle:8646976`/`8567904`/`8575697`；测试 `src/utils/powershell/__tests__/parser.test.ts`。
- `/upgrade` 的 `tengu_slate_harbor` 不可用门控与文案：`bundle:10960766`/`8201980`。
- auto-mode：policy `permissions.defaultMode === 'auto'` 视为已同意：`bundle:1076103`。
- `/buddy` 可用性检查与 `buddy is unavailable on this configuration`，并补 `argumentHint [pet|off]`：`bundle:11268057`/`11267662`。
- CCR 远程会话瞬时重试耗尽后的友好文案：`bundle:10638117`。
- extractMemories 提示词改为单一 opener，类型/禁忌/frontmatter 引用系统提示词 Memory 段，删除 `tengu_moth_copse`/`skipIndex` 分支：`bundle:9422824`/`9422852`；测试 `src/services/extractMemories/__tests__/prompts.test.ts`。

未加单测的薄胶水项（`/upgrade`、auto-mode、`/buddy`、CCR 文案）依赖真实 OAuth/网络/时钟，验收证据为唯一字符串偏移。

## 对照官方 v2.1.90 changelog 的补充移植（R13–R21）

以官方 release tag 的变更说明逐条对拍，发现 inventory/align 流水线之外的 9 处 CLI 可见差异，均已移植；随后对 PowerShell 只读允许表做全量对拍，又补 1 处（R21）。每项都回到 2.1.90 bundle 定位上游实现并逐行对照语义（不只是命中字符串）：`.husky` 数组、`cbY`/`QbY` 的 resume 过滤、`BbY`/`Kc8` 的 `Promise.all`、`e36` 的 rate-limit ref、hook 的 `status===2` 分支、`m$K`/`p$K`/`Oaz` 的动作参数校验、`Asz` 解压器集合、解析失败兜底的 every-token 循环、`ipconfig` 的 safeFlags 与 positional-arg 回调。对拍中发现的唯一遗漏（`sessionKind`）已在 R14 补齐。逐项记录如下：

- R13 `.husky` 权限提示：`.husky` 加入 `DANGEROUS_DIRECTORIES`（`bundle:11426036`）；测试 `src/utils/permissions/__tests__/dangerousDirectories.test.ts`。
- R14 `/resume` 过滤：SDK 会话（`sdk-cli`/`sdk-ts`/`sdk-py`）与 `/loop` 会话不再出现；`LiteMetadata`/`LogOption` 增加 `entrypoint`、`isLoopSession`，`readLiteMetadata` 从头部提取并扫描 `<command-name>/loop</command-name>`（`bundle:11398167`、`11394680`）：测试 `src/utils/__tests__/resumeSessionFilters.test.ts`。与 bundle 的 `cbY`/`QbY` 对拍后补齐同处的 `sessionKind` 过滤：仅 `bg`/`daemon`/`daemon-worker` 视为非交互会话，其余值（如 `interactive`）保留。
- R15 `/resume` 跨项目并发加载：all-projects 加载器用 `Promise.all`（`bundle:11386475`）。
- R16 rate-limit 对话框只自动打开一次：`hasAutoOpenedRateLimitOptionsRef` 守卫（`bundle:12406124`）。
- R17 hook JSON 输出退出码 2 视为 blocking：`hooks.ts` 用 stderr 填充 `blockingError` 并将 outcome 置为 blocking（`bundle:11474283`）。
- R18 PowerShell 动作参数值白名单：`-ea/-wa/-infa/-proga` 及长形式仅允许 silent/continue/stop 系列；`Get-DnsClientCache` 移出白名单，`ipconfig` 仅保留 `/all`、`/allcompartments`（`bundle:8587021`、`8598753`）；测试 `src/tools/PowerShellTool/__tests__/readOnlyValidation.test.ts`。交叉验证补：上游 2.1.90 的公共参数集 `x$K`（`bundle:8587270`）同时并入 4 个短别名，本仓库 `commonParameters.ts` 原先只在 safeFlags 循环外单独校验短形式取值，导致 `-ea SilentlyContinue` 仍会因不在 safeFlags 中而被拒；现把 `-ea/-wa/-infa/-proga` 加入 `COMMON_VALUE_PARAMS`，safeFlags 跳过与 pathValidation 已知参数合并都与上游一致。
- R19 归档解压 TOCTOU：解压器守卫从 git 子命令分支移出，任何含 tar/unzip 的复合命令都 ask（`bundle:8649622`）。该分支依赖成功解析的 AST，本机无 pwsh，无单测，静态偏移为证据。
- R20 解析失败时的 deny 兜底：改为逐 token 重建候选命令并做 prefix 匹配，同时对每段运行 Remove-Item 危险路径硬拒绝（`bundle:8645984`）；测试 `src/tools/PowerShellTool/__tests__/powershellPermissions.test.ts`。
- R21 `arp` 位置参数：全量抽取上游 `B$K`（`bundle:8593381`）84 个 cmdlet 配置与 `CMDLET_ALLOWLIST` 逐项对拍，唯一差异是 `arp`（`bundle:8599833`）：2.1.89 为 `safeFlags:["-a","-g","-v","-N"]`、无回调；2.1.90 改为 `-n` 并新增回调，任何非 `-` 开头参数（`arp <host>`、`arp -s <ip> <mac>`）都判危险。上游同时把 `arp` 加进回调门控集合 `Laz`（`bundle:8628143`，本项目对应 `ARG_GATED_CMDLETS`），否则权限对话框会为它建议 `arp:*` 通配并永久绕过回调；已同步并加跨表一致性测试。2.1.90 台账此前漏记该项（纯表项变更未进 inventory）。测试：`src/tools/PowerShellTool/__tests__/readOnlyValidation.test.ts`、`src/utils/powershell/__tests__/dangerousCmdlets.test.ts`。
- 另外对 2.1.89 → 2.1.90 的 PowerShell 常量集全量对拍（`FYK` → `B$K`、`Joz` → `Laz`、`x$K`/`p$K` 等）：除上述 `arp`、`ipconfig /displaydns`、`get-dnsclientcache` 与动作参数白名单外，唯一差异是回调 `nX` → `YP` 的改名，函数体逐字符相同，无需移植。

changelog 中未移植的条目及原因：

- `#5`（`CLAUDE_CODE_DISABLE_ATTACHMENTS` 相关）：本仓库无对应附件路径，不存在该 env 读取点。
- `#8`、`#10`、`#11`、`#12`、`#16`：属于 UI 组件/渲染或性能优化，仓库对应组件分化（自研 RCS/REPL），无逐行对应的上游路径可移植；不影响 CLI 行为契约。
- `#14`：无对应仓库路径。
- `#15`：打包依赖（MCP SDK）内部实现，归入 R8 依赖噪声。
- `#9`：本仓库无对应的 classifier（`yolo-classifier-prompts` 为占位），归入 R10。

## 台账说明

- `env:CLAUDE_CODE_HOST_HTTP_PROXY_PORT`、`env:CLAUDE_CODE_HOST_SOCKS_PROXY_PORT`、`env:CLAUDE_CODE_RESUME_THRESHOLD_MINUTES`、`env:CLAUDE_CODE_RESUME_TOKEN_THRESHOLD`、`env:CLAUDE_CODE_SM_COMPACT` 五个条目沿用 2.1.89 的近似结论（R6：打包依赖或扫描噪声），2.1.90 未变化。
- 版本引用已同步至 2.1.90：`scripts/upstream-version.ts`、`scripts/__tests__/upstream-version.test.ts`、`bunfig.toml`（`scripts/config.ts` 由常量派生，无需改动）。

## 验收后补的端到端测试（R22）

此前的 PowerShell 单测都用合成 AST（手写 `elementTypes`），可能与真实 pwsh 解析器的输出形状漂移；`/help` `/powerup` 提示与 `/powerup` 首屏只有逻辑测试，没钉住 Ink 渲染与行数门控。为此补两批 E2E：

- `tests/ink-harness.tsx` 增加 `rows` 参数（原先写死 24）：Ink 从 `stdout.columns/rows` 读布局尺寸（`ink.tsx:238-239`），`General.tsx` 的 /powerup 提示门控依赖 `rows >= 44`，不传行数无法测到「高终端显示、矮终端隐藏」。
- `tests/help-powerup-render.test.tsx`（3 例）：`rows:50` 断言提示文案与 Shortcuts 表共存，`rows:24` 断言提示消失；`Powerups` 在 `AppStateProvider` 下渲染首屏 `Power-ups`、`0/10 unlocked` 与 lesson 标题。用临时 `CLAUDE_CONFIG_DIR` 隔离 `powerupsUnlocked`。
- `src/tools/PowerShellTool/__tests__/powershellRealParseE2E.test.ts`（10 例，`describe.skipIf(!hasPwsh)`）：用真实 pwsh 解析而非合成 elementTypes，覆盖 `arp <host>` / `arp -s` 拒绝、`arp -a` 放行、`-ea SilentlyContinue` 放行而 `-ea Break` 拒绝、Unicode en-dash 别名归一、后台作业 `&` ask、复合解压 ask、`Remove-Item -Recurse .` ask。无 pwsh 的机器整体 skip，不误报。
- 测试口径澄清：未自动放行的命令走完权限 reduce 后返回 `behavior:'passthrough'`（携带建议项以触发审批对话框），不是 `ask`；`arp 192.168.1.1` 的 E2E 断言据此写成 `passthrough`，`arp -a` 为 `allow`。本机 pwsh 版本 7.7.0（官方 tarball + 校验和核对后装入 `/usr/local/bin`）。
- 上述文件已作为 `test:` 证据登记到对应台账条目（`cmd:powerup`、`behavior:powerup-help-hint`、五个 PowerShell 行为）。

- 验收命令：
  ```bash
  bun scripts/upgrade/cli.ts verify \
    --target /tmp/upgrade-2.1.90/package/cli.js \
    --reference /tmp/upgrade-2.1.90/ref-2.1.89/package/cli.js \
    --src src --status docs/upgrade/2.1.90/status.json --out docs/upgrade/2.1.90
  ```
