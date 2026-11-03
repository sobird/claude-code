# 2.1.89 近似实现与未解点

（条目随各 Task 完成补充。）

## 近似实现

### /autocompact

- 依据 `package/cli.js` 静态抽取：参数解析 `HfK` @9495310、窗口解析 `j56` @9495559、状态文案 `s2Y` @9931819、set/reset `b78` @9932347、注册 `type:"local-jsx",name:"autocompact"` @9937634、设置 schema `.number().int().min(1e5).max(1e6)` @1053664、`CLAUDE_CODE_AUTO_COMPACT_WINDOW` @9495609。范围常量 `D17=1e5`、`jfK=1e6`。
- 数值格式化使用仓库现有 `formatTokens`（Intl compact，`120000` → `120k`），等价于 bundle 的 `A3`/`uK` 近似；两者对 100k–1M 区间输出一致。
- 交互 UI（`autocompact.tsx`）为近似实现：无参数时用 `Dialog` 显示与 `s2Y` 相同的文案，Esc 关闭；带参数时直接走 set/reset 并 `onDone`。上游的上下键滑块（步进 100k）与 `tengu_autocompact_dialog_opened` 事件未移植。
- 分析事件 `tengu_autocompact_command` 未发送：仓库 `LogEventMetadata` 只允许 boolean/number/undefined，而该事件含字符串 `action`，按“非平凡则省略”处理。
- R16：测试按 2.1.89 语义使用 `'50000' → invalid`（范围下限 100k），并导出 `parseAutocompactArgs`；`'2m'` 同样越界为 invalid。
- R17：`scripts/upgrade/scenarios/cmd-autocompact.json` 为 `--version` 探针场景，probe 产出空 trace（`/tmp/autocompact.json`）；以上静态偏移为验收证据。
- R18：窗口配置真正参与压缩判定。`getEffectiveContextWindowSize()` 改为 `resolveAutocompactWindow(model, getInitialSettings().autoCompactWindow).window` 后再扣除摘要预留，因此 `/autocompact 300k` 会改变 autocompact 阈值；纯解析器与 `AUTOCOMPACT_MIN/MAX_WINDOW` 迁至 `src/services/compact/autocompactWindow.ts`（不依赖 `autoCompact.ts` 或命令模块）。
- AppState 近似：压缩服务读取初始设置快照（`getInitialSettings()`）而非 `AppState.autoCompactWindow`，避免 services 依赖 UI store；`/autocompact` 写入 `userSettings` 后需设置重载/下个会话生效。Task 19 必须保留该近似。
- 格式/UI 近似：数值格式化沿用仓库 `formatTokens`；交互 UI 为只读 `Dialog`（无上下键滑块，未发送 `tengu_autocompact_dialog_opened`）；`GlobalConfig.autoCompactWindow` 已移除（保留 settings schema 与 AppState 字段）。

### /brief

- 依据 `package/cli.js` 静态抽取：注册 `type:"local-jsx",name:"brief",description:"Toggle brief-only mode"` @11179551。
- 外部构建已编译 `KAIROS_BRIEF` 特性，命令模块会被打包；但运行时可见性仍由 GrowthBook `tengu_kairos_brief_config.enable_slash_command`（默认 `false`）控制，`isEnabled` 直接返回该值。
- R19：slash 命令不出现在 CLI `--help`，故验收改为「`features` 含 `KAIROS_BRIEF`」+「external `dist/cli.js` 含 `Toggle brief-only mode`」。

### /buddy

- 依据 `package/cli.js` 静态抽取：注册 `type:"local-jsx",name:"buddy",description:"Hatch a coding companion · pet, off",immediate:!0` @11229990；`call()` 行为同段 11229990–11230620；可见性门 `H_7`（firstParty、非 essential-traffic、2026-04 起；ant 构建跳过日期门）同段。
- soul 生成 `sBK`/`FRY` @11212865 / 11229627：`sideQuery` + `getSmallFastModel()` + `querySource:"buddy_companion"`、JSON schema 输出、inspiration 词 LCG、fallback soul、hatch 落盘 `{ soul, hatchedAt }` 均移植到 `src/buddy/soul.ts`；UI 面板/孵化动画对应 `aQ8`/`YgK`。
- R20：上游 `pet` 会向私有鉴权端点发起 reaction 请求并显示气泡；本仓库不移植 reaction plumbing，`/buddy pet` 仅写 `companionPetAt`（爱心仍由 `CompanionSprite` 渲染），孵化后也不生成 reaction。命令面板因此没有 “last said” 区块。
- R21：slash 命令不出现在 CLI `--help`，故验收改为「`features` 含 `BUDDY`」+「external `dist/cli.js` 含 `Hatch a coding companion`」；`scripts/upgrade/scenarios/cmd-buddy.json` 为 `--version` 探针场景，probe 产出空 trace，静态偏移为验收证据。

### /web-setup

- 依据 `package/cli.js` 静态抽取：注册 `type:"local-jsx",name:"web-setup",description:"Setup Claude Code on the web (requires connecting your GitHub account)",availability:["claude-ai"]` @11209069。
- 2.1.89 的注册（`src/commands/remote-setup/index.ts`）与 `remote-setup.tsx` 流程已与本仓库源码逐项一致（含用户可见文案、`availability: ['claude-ai']` 及 `isEnabled`/`isHidden` 门），本 Task 不修改两者。
- 保留运行时门：可见性仍由 GrowthBook `tengu_cobalt_lantern` + `isPolicyAllowed('allow_remote_sessions')` 控制，未放宽。
- R22：slash 命令不出现在 CLI `--help`，故验收改为「`features` 含 `CCR_REMOTE_SETUP`」+「external `dist/cli.js` 含 `Setup Claude Code on the web`」；`scripts/upgrade/scenarios/cmd-web-setup.json` 为 `--version` 探针场景，probe 产出空 trace，静态偏移为验收证据。

## Task 23 — channels (R34)

- 结论：`--channels` / `channelsEnabled` / `defaultView` 在 2.1.88 源码树中已完整实现，2.1.89 无需移植，本 Task 仅做验证与回归测试。
- bundle 偏移 → 既有源码位置：
  - `12974406` → CLI 选项 `--channels <servers...>` / `--dangerously-load-development-channels <servers...>`：`src/main.tsx:4494`、`src/main.tsx:4500`（文案与 bundle 一致）。
  - `10197914` → 内联解析与 `tengu_mcp_channel_flags` 遥测：`src/main.tsx:2121`–`2146`。
  - `1056793` → `findChannelEntry`（bundle `_J6`）与 gate 顺序（capability → disabled → auth → policy → session → marketplace → allowlist，reason 文案一致）：`src/services/mcp/channelNotification.ts`。
  - `10488459` → allowlist（`tengu_harbor_ledger` / `tengu_harbor`）：`src/services/mcp/channelAllowlist.ts:39`、`:50`。
  - `12998609` → permission relay（bundle `uyK`/`IyK`/`myK`/`pyK`/`ByK`/`gyK`/`LXY`）：`src/services/mcp/channelPermissions.ts`。
  - `10196674` → 通知/对话框：`src/components/LogoV2/ChannelsNotice.tsx`、`src/components/DevChannelsDialog.tsx`。
  - `10199598` → 设置项 `channelsEnabled`（托管策略、默认关闭）与 `defaultView: z.enum(['chat','transcript'])`：`src/utils/settings/types.ts:721`、`:749`，消费点 `src/main.tsx:2675`、`src/components/Settings/Config.tsx:765`。
- 测试：`tests/channels-2.1.89.test.ts` 固定 `findChannelEntry`、`shortRequestId`、`truncateForPreview`、`filterPermissionRelayClients` 与 `channelsEnabled` schema。
- `defaultView` 位于 `feature('KAIROS') || feature('KAIROS_BRIEF')` 展开内，`bun test` 运行时两开关均关闭，故该键为 schema 未知字段（外层 `.passthrough()` 会静默接受，无法断言枚举）；测试据 R34 仅覆盖 `channelsEnabled`，`defaultView` 以上述静态位置为准。
- `scripts/upgrade/scenarios/channels.json` 为 `--version` 探针场景，probe 无法驱动 channels（GrowthBook + MCP 服务器 + claude.ai OAuth），证据为 `package/cli.js` 静态偏移。

## Task 24 — fast mode / PowerShell / sandbox (R35)

- 结论：三个 "bundle-only" 领域在 2.1.88 源码树中均已实现；2.1.88→2.1.89 的增量主要是压缩器重命名，2.1.89 新增字符串在本仓库 `src/` 中均可找到。本 Task 仅做验证与回归测试，未改动任何 `src/` 文件。
- bundle 偏移 → 既有源码位置：
  - `10729316`（`Fast mode overloaded and is temporarily unavailable`）→ fast mode 错误 UX：`src/utils/fastMode.ts`（`getFastModeUnavailableReason`、`isFastModeEnabled`、cooldown 状态机）、`src/hooks/notifs/useFastModeNotification.tsx`、`src/commands/fast/fast.tsx`、`src/components/ModelPicker.tsx`。
  - `8556815`（`PowerShell parser: command too long`）→ PowerShell 安全规则：`src/tools/PowerShellTool/powershellSecurity.ts`（`powershellCommandIsSafe`）、`src/tools/PowerShellTool/powershellPermissions.ts`、`src/utils/powershell/{parser,dangerousCmdlets,staticPrefix}.ts`。
  - `4376088`（`Optional MITM proxy configuration`）→ sandbox MITM/proxy：字符串属于打包依赖 `@anthropic-ai/sandbox-runtime`，忽略该依赖内部实现。CLI 自有的配置面已存在：`src/entrypoints/sandboxTypes.ts`（`httpProxyPort`、`socksProxyPort`、`enableWeakerNestedSandbox`、`enableWeakerNetworkIsolation`），以及 `/sandbox` UI 组件与 egress-proxy denial。
- 忽略依赖理由：MITM 代理服务器、Unix-socket relay、域名路由、seccomp/bwrap 及 `[Sandbox Linux]` 内部实现均由打包的 `@anthropic-ai/sandbox-runtime` 提供，按用户指令（忽略 bundle 依赖）不移植；本仓库只负责配置 schema 与 CLI 表面。
- 测试：`tests/bundle-only-behaviors.test.ts` 固定：fast mode 禁用/cooldown API；PowerShell 的 `classifyCommandName`/`stripModulePrefix`/`MAX_COMMAND_LENGTH` 与 `powershellCommandIsSafe`（拒绝 `Invoke-Expression`、接受 `Get-ChildItem`、解析失败返回 ask）；sandbox schema 的 `httpProxyPort`/`socksProxyPort` 与 weaker isolation 标志。
- 与 R35 示例的偏差：`classifyCommandName('node')` 按源码契约返回 `'unknown'`（裸名歧义），并非 `'application'`；测试固定为 `'unknown'`，`'application'` 用路径形式（如 `./node`）覆盖。
- `scripts/upgrade/scenarios/fast-powershell-sandbox.json` 为 `--version` 探针场景；上述行为需要真实 API/pwsh/sandbox 状态，probe 无法复现，证据为 `package/cli.js` 静态偏移。

## 未解点

### defer 暂停/恢复

- 暂停条件（`shouldDeferPermission`）：仅 print/headless 会话（`isNonInteractiveSession`）且当前 assistant message 只有 1 个 `tool_use` 时生效。交互模式忽略并告警 `Hook <name> returned permissionDecision=defer in interactive mode; ignoring (defer is print-mode only)`；同批多个工具调用也忽略并告警 `... but N tool calls are in this batch; ignoring (defer is solo-only — siblings would be orphaned on resume)`。hook 生成器在整轮 hook 结束后才 yield `defer`，期间若有 hook 返回 deny 则抑制该事件（`bundle:9415778`）。
- attachment 结构（`HookDeferredToolAttachment`）：`{ type: 'hook_deferred_tool', toolUseID, toolName, toolInput, hookName, hookEvent, permissionMode }`。`toolExecution.ts` 在 `case 'defer'` 中写入该 attachment 并立即 `return resultingMessages`，不执行工具。
- 渲染字符串：`<hookName> deferred <toolName> · resume with -p --resume to continue`（`AttachmentMessage.tsx`）。
- transcript marker 扫描（`readDeferredToolUse`）：只读文件尾部 1 MB（`tailFile`），从后往前找最后一条 `type:"attachment"` 且 `attachment.type === "hook_deferred_tool"` 的记录；若该记录之后出现引用同一 `tool_use_id` 的行（说明工具已运行），视为陈旧 marker 返回 `undefined`。畸形 JSON 行跳过，读取/解析失败也按“无 marker”处理。
- resume 重放：`QueryEngine` 从会话消息中定位原 `tool_use` 块，经 `runTools` 重新走 PreToolUse；若 hook 再次 defer，则再写 marker 并产出 `stop_reason:'tool_deferred'` 的成功 result；若原工具已不存在（MCP 断开/工具移除），产出 `stop_reason:'tool_deferred_unavailable'`、`is_error:true`、`result:''` 的 result。两处 result 都带 `deferred_tool_use:{id,name,input}`。
- `query.ts` 在工具结果循环中检测到 `hook_deferred_tool` attachment 后，于 `aborted_tools` 检查之后返回 `{reason:'tool_deferred'}`。`print.ts` 在存在 marker 时无条件 enqueue 合成提示 `Continue from where you left off.`（`isMeta`），并允许无输入提示的 `--resume`。
- R25：probe 无法驱动两进程的“暂停→resume”流程，故以 bundle 静态偏移为权威证据（`9415778`、`9422415`、`9495528`、`12897935`、`12903928`、`12917388`、`12935025`、`11414290`）；端到端真实 API 冒烟未运行。
