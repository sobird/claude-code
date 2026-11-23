# 2.1.92 近似实现与未解点

台账：`docs/upgrade/2.1.92/status.json`（reference 2.1.91 → target 2.1.92）。产物位于 `/tmp/upgrade-2.1.92/`：`package-2.1.92/cli.js`（2.1.92）、`ref-2.1.91/cli.js`（2.1.91）、`work/inventory-2.1.9{1,2}.json`、`work/align-2.1.92/`、`work/candidates-2.1.92/`、`work/strings-2.1.92/`、`work/releasenotes/notes.json`、`work/table-*.json`、`work/refresh-2.1.92.json`、`work/gates-2.1.92/`、`work/verify-*/`。文中偏移均为解码后字符偏移。

## 增量范围

inventory 对拍（2.1.91 → 2.1.92）结果：

- 命令：新增 `setup-bedrock`、`stop-hook`、`teleport`（均 local-jsx）；移除 `tag`。
- `CLAUDE_CODE_*`：新增 `CLAUDE_CODE_EXECPATH`、`CLAUDE_CODE_SIMULATE_PROXY_USAGE`、`CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK`；无移除。
- CLI flag：inventory 未收录 `--remote-control-session-name-prefix`（走帮助/解析路径），已在台账显式登记。
- 字符串：`strings` 分诊后新增 inSrc 170 / releaseNotes 48 / noise 13 / unclassified 23；移除 inSrc 123 / releaseNotes 31 / noise 2 / unclassified 11。新增 `inSrc` 多为本仓库已有文案（含本次新增文件的字符串），`noise` 来自打包依赖（`@aws-sdk/*`、`@smithy/*`、GrowthBook SDK、`axios` 等）。

## 台账统计

- `ported`：18 个 behavior + 3 个 `cmd:` + 1 个 `flag:` + 3 个 `env:`。
- `approximated`：`behavior:apply-seccomp-vendor`（R3）+ 5 个沿用的依赖/扫描噪声 `env:`。
- 删除类（`/tag`、`/vim`）以 `bundle:absent:` 证明目标 bundle 已无对应命令描述。
- 无 `unresolved`；`missingInSrc` / `unexpectedInSrc` / `unregistered` / `evidenceErrors` / `srcEvidenceErrors` / `uncoveredReleaseItems` 均为空。

## changelog 21 条对照

1. `forceRemoteSettingsRefresh` @`bundle:1052685`：`src/utils/settings/types.ts` 增布尔设置；`src/services/remoteManagedSettings/index.ts` 的 `fetchAndLoadRemoteManagedSettings` 返回 `{settings, fetchSucceeded}`，新增 `FORCE_REMOTE_SETTINGS_REFRESH_ERROR`；`src/main.tsx` 在首次加载与引导后刷新两处，策略开启且 `fetchSucceeded=false` 时 `process.exit(1)`（fail-closed）。
2. Bedrock 设置向导 @`bundle:10928725`/`10928968`：`src/components/ConsoleOAuthFlow.tsx` 的 `platform_setup` 改为平台选择器（Bedrock 进入 `bedrock_wizard`，Foundry/Vertex 打开文档）；新增 `src/components/BedrockSetupWizard.tsx`、`src/utils/bedrockSetup.ts`（profile/bearer/accessKey/environment 认证、region、STS 身份校验、模型 pin），并注册 `setup-bedrock` 命令。
3. `/cost` 按模型族与缓存命中拆分 @`bundle:8746302`：`src/cost-tracker.ts` 新增 `getCostBreakdown`；`src/commands/cost/cost.ts` 由 `tengu_amber_lark` 门控输出。
4. `/release-notes` 交互式版本选择器 @`bundle:10797447`：`index.ts` 改 local-jsx；新增 `release-notes.tsx`（Select+Dialog，含 Show all），删除 `release-notes.ts`。
5. Remote Control 会话名前缀 @`bundle:11697226`（flag @`11697224`）：`src/bridge/bridgeConfig.ts` 新增 `sanitizeSessionNamePrefix`/`getBridgeSessionNamePrefix`；`bridgeMain.ts`、`initReplBridge.ts` 用 `${prefix}-${slug}` 作标题；`main.tsx` 解析 `--remote-control-session-name-prefix` 并透传。
6. Pro 缓存过期页脚提示 @`bundle:12079646`/`12081700`：`src/components/PromptInput/Notifications.tsx` 新增 `getCacheExpiredHint`（≥50k 且闲置 >1h），`pro` + `tengu_amber_swift` 门控，30s 轮询。
7. tmux pane count 修复 @`bundle:8172514`：`src/utils/swarm/backends/TmuxBackend.ts` 在实例上缓存稳定窗口目标 `@N`。
8. prompt 型 Stop hook @`bundle:11514629`/`11515534`：`src/utils/hooks/execPromptHook.ts` 对 Stop/SubagentStop 用专门系统提示、`tools: []`、schema 要求 `ok`+`reason`；未命中时 Stop 类不设 `preventContinuation`，非 Stop 类保持 `true`。
9. 流式 JSON 字符串参数强制转换 @`bundle:9787523`：`src/utils/messages.ts` 新增 `coerceStringifiedJsonFields`/`unwrapZodDefType`，`normalizeContentFromAPI` 在 `normalizeToolInput` 前先转换，失败回退转换值。
10. 仅空白 thinking 文本块 @`bundle:4967734`：`mergeAssistantMessages` 合并时丢弃空白 text 块（过滤后只剩 thinking 则保留）。
11. 反馈问卷误提交 @`bundle:12352100`：`useDebouncedDigitInput.ts` 增加 `mountDelayMs`（默认 600ms，重新 enabled 重置），数字归一改 `normalize('NFKC')`；followup “1” 热键 `mountDelayMs:0`。
12. esc 提示与选区冲突 @`bundle:8089809`：`PromptInputFooterLeftSide.tsx` 的 `getSpinnerHintParts` 增 `hasSelection`，有选区时不渲染 esc to interrupt。
13. Homebrew cask 通道 @`bundle:7877165`：`packageManagers.ts` 新增 `getHomebrewCaskName`（`/Caskroom/([^/]+)/`），`PackageManagerAutoUpdater.tsx`、`cli/update.ts` 据 cask 名选 stable/latest。
14. ctrl+e 行尾行为 @`bundle:10883795`：`src/utils/Cursor.ts` 的 `endOfLine()` 在已在行尾时前进到下一行行尾（见 R6）。
15. 全屏滚动重复行 @`bundle:3784769`：`src/ink/render-node-to-output.ts` 仅在存在上一屏且满足 fast-path 时记录 `scrollHint`；`src/ink/selection.ts` 在选择区上移时按 `min(oldAboveDebt-newAboveDebt, scrolledOffAbove.length)` 收缩。
16. idle-return token 计数 @`bundle:12500409`：`src/screens/REPL.tsx` 改用 `tokenCountWithEstimation(getMessagesAfterCompactBoundary(...))` 得到 `contextTokens`。
17. 插件 MCP 卡 connecting @`bundle:13126870`：`src/services/mcp/config.ts` 的 `getClaudeCodeMcpConfigs` 移除 `extraDedupTargets`——未认证 connector 永不连接，若作插件去重目标会让插件项永久 pending；改由 `dedupClaudeAiMcpServers`（connector 对 manual）承担。`useManageMCPConnections.ts` 仅在 Phase 2 await claude.ai 拉取。
18. Write 工具 diff 提速 @`bundle:8809070`：`src/utils/diff.ts` 新文件按换行计数、`getPatchFromContents` 增 `convertTabs`；`FileWriteTool.ts` 改用 `getPatchFromContents({convertTabs:true})`。
19. 移除 `/tag` @`bundle:absent:Toggle a searchable tag on the current session`：删除 `src/commands/tag/`，并从 `src/utils/sessionStorage.ts` 移除 `saveTag`/`getCurrentSessionTag`。
20. 移除 `/vim` @`bundle:absent:Toggle between Vim and Normal editing modes`：删除 `src/commands/vim/` 与 `commands.ts` 注册。
21. `apply-seccomp` 助手 @`bundle:4350872`：`vendor/seccomp/{x64,arm64}/apply-seccomp` 已入库，`SandboxDependenciesTab.tsx` 缺失提示指向 `vendor/seccomp/*`（见 R3）。

## 验收补充（R 编号）

- R1：GrowthBook/灰度门控项（`tengu_amber_lark`、`tengu_amber_swift`、`tengu_gleaming_fair` 等）离线不可驱动，验收证据为静态偏移 + 默认分支；未登记的取默认值时与上游未命中灰度一致。
- R2：`cmd:teleport` 不属于 21 条 release 说明，但 inventory 判定为目标新增命令，台账要求闭合。本仓库的 teleport 机制（`src/utils/teleport.tsx`、`TeleportResumeWrapper`、`useTeleportResume`）早已存在，此前命令注册是名为 `stub` 的占位；本次按上游 `ChY` 对象补全：`type:'local-jsx'`、`name:'teleport'`、别名 `tp`、门控 `isClaudeAISubscriber() && isPolicyAllowed('allow_remote_sessions')`，`load` 渲染 `TeleportResumeWrapper`（`isEmbedded`、`source:'localCommand'`），完成时 `context.setMessages(() => result.log)` 并回显成功；未改动任何 teleport 业务逻辑。
- R3：`apply-seccomp` 记为 `approximated`。二进制已入库，但本仓库没有上游把助手注入 npm/native 产物的打包脚本，实际随构建分发的接线在打包侧，`src/` 只提供 `vendor/seccomp/*` 与缺失提示。
- R4：`cmd:stop-hook` 上游 `isEnabled` 恒 `false`（隐藏），本仓库保持同样隐藏状态，避免暴露未启用的会话级 Stop hook 入口。
- R5：删除项即移植。`/tag`、`/vim` 的源码与注册一并删除；目标 bundle 已无其命令描述字符串（`bundle:absent:` 证据）。`sessionStorage.ts` 的 `saveTag`/`getCurrentSessionTag` 仅被 `/tag` 使用，随之移除。
- R6：第 14 条 release 说明为「`ctrl+e` 在已在行尾时跳到下一行行尾」；实现按此语义，在行尾时前进到下一行行尾（含软换行边界），非“停在原地”。
- R7：字符串分诊。新增 `unclassified` 23 条经回查为上游未列入 release 说明的其它改动或依赖/实验键：GrowthBook 实验键（`tengu_amber_lantern`/`tengu_amber_redwood`/`tengu_velvet_anchor`/`tengu_onyx_basin_m1k`/`tengu_advisor_dialog_shown`/`tengu_bash_rerun_used`/`tengu_tool_result_dedup`/`tengu_rate_limit_options_menu_select_team`/`autocompact-experiment-hint`）、Write 工具提示补充（“追加到已有文件优先用 shell 重定向”）、sandbox/权限（XPC/Mach services、`com.example.*` 通配说明）、OAuth（`offline_access` scope）、plan/advisor UI、voice、版本日期常量等。除本仓已具备者外不移植（不在 21 条范围内）。移除的 `unclassified` 11 条中，`/tag` 与 `platform_setup` 旧文案分别对应第 19、2 条，其余为 sandbox-runtime 依赖字符串与日期常量。
- R8：五个依赖/扫描噪声 `env:`（`CLAUDE_CODE_HOST_HTTP_PROXY_PORT`、`CLAUDE_CODE_HOST_SOCKS_PROXY_PORT`、`CLAUDE_CODE_RESUME_THRESHOLD_MINUTES`、`CLAUDE_CODE_RESUME_TOKEN_THRESHOLD`、`CLAUDE_CODE_SM_COMPACT`）沿用 2.1.91 结论，偏移刷新到 2.1.92 bundle。
- R9：`gates --ref HEAD --fail-on-new` 的 **test** 段报 390 条 `(fail)` 新增（baseline/current 退出码均 1；typecheck、lint 均 `No new findings`）。这些条目全部来自 `packages/rcs`（ACP/Environment/Disconnect/Session/Web 路由与共享 PGlite 测试），与本次 2.1.92 的 `src/`、`docs/`、`vendor/` 改动无关：本次未修改 `packages/rcs`。原因是 gate 的 test 门禁直接跑 `bun test`（递归全仓，含 `packages/rcs`），而工作区里同时存在用户未提交的 RCS 进行中改动（`session-reducer`、`ToolCallGroup`、`FileToolView` 等）；baseline worktree 取 `HEAD` 无这些改动、且其 rcs 用例缺少工作区环境，两轮都退出 1。旁证：工作区单跑 `bun test packages/rcs` 为 1198 pass / 0 fail，`session-reducer.test.ts` 148 pass / 0 fail；全仓 `bun test` 并行负载下仅偶发 `reduceSessionEvent` 两条图片用例 flake。结论：非本升级引入，属门禁环境 + 未提交并行改动所致。

## 交叉验证（§1.5）

- `table --whole`：2.1.91 vs 2.1.92、2.1.92 vs `src` 的 PowerShell cmdlet 允许表（`"get-date":{safeFlags…`）均 **0 added / 0 removed / 0 changed**；本版未触及白名单/安全表。
- `strings`：见「增量范围」与 R7。
- `refresh-evidence`：`updated 0 / skipped 0`，所有 `bundle:` 偏移在 2.1.92 bundle 中仍有效。
- `verify`（strict）：`ok=true`，六类错误清单全空。

## 验收命令

```bash
# 台账闭合（strict：证据 + srcEvidence + releaseItems 覆盖）
bun scripts/upgrade/cli.ts verify \
  --target /tmp/upgrade-2.1.92/package-2.1.92/cli.js \
  --reference /tmp/upgrade-2.1.92/ref-2.1.91/cli.js \
  --src src --status docs/upgrade/2.1.92/status.json --out docs/upgrade/2.1.92 \
  --release-notes /tmp/upgrade-2.1.92/work/releasenotes/notes.json --strict-evidence

# 交叉验证：release 说明 → strings 分诊 → 常量表对拍 → 证据刷新 → 基线门禁
bun scripts/upgrade/cli.ts strings \
  --target-inventory /tmp/upgrade-2.1.92/work/inventory-2.1.92.json \
  --reference-inventory /tmp/upgrade-2.1.92/work/inventory-2.1.91.json --src src \
  --release-notes /tmp/upgrade-2.1.92/work/releasenotes/notes.json --out /tmp/upgrade-2.1.92/work/strings-2.1.92
bun scripts/upgrade/cli.ts table --bundle /tmp/upgrade-2.1.92/package-2.1.92/cli.js \
  --anchor get-date --whole \
  --src src/tools/PowerShellTool/readOnlyValidation.ts#CMDLET_ALLOWLIST --out /tmp/upgrade-2.1.92/work/table-src.json
bun scripts/upgrade/cli.ts refresh-evidence --target /tmp/upgrade-2.1.92/package-2.1.92/cli.js \
  --status docs/upgrade/2.1.92/status.json --out /tmp/upgrade-2.1.92/work/refresh-2.1.92.json --in-place --fail-on-skipped
bun scripts/upgrade/cli.ts gates --ref HEAD --out /tmp/upgrade-2.1.92/work/gates-2.1.92 --fail-on-new
```
