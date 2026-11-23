# 2.1.94 近似实现与未解点

台账：`docs/upgrade/2.1.94/status.json`（reference 2.1.92 → target 2.1.94）。产物位于 `/tmp/upgrade-2.1.94/`：`package-2.1.94/package/cli.js`（2.1.94）、`package-2.1.92/cli.js`（2.1.92，参照）、`work/inventory-2.1.9{2,4}.json`、`work/align-2.1.94/`、`work/strings-2.1.94/`、`work/releasenotes/notes.json`、`work/table-src.json`、`work/report/`、`work/status-refreshed.json`、`work/gates/`。文中偏移均为解码后字符偏移。

## 增量范围

inventory 对拍（2.1.92 → 2.1.94）结果：

- 命令：新增 `autofix-pr`、`team-onboarding`；无移除。
- `CLAUDE_CODE_*`：新增 `CLAUDE_CODE_MCP_ALLOWLIST_ENV`、`CLAUDE_CODE_SANDBOXED`、`CLAUDE_CODE_SKIP_MANTLE_AUTH`、`CLAUDE_CODE_TEAM_ONBOARDING`、`CLAUDE_CODE_USE_MANTLE`；无移除。
- CLI flag：inventory 无增删；但目标 bundle 含隐藏 flag `--thinking-display <display>`（inventory 漏收），已手动登记并移植（见 R7）。
- 字符串：`strings` 分诊后新增 inSrc 97 / releaseNotes 132 / noise 6 / unclassified 82；移除 inSrc 39 / releaseNotes 15 / noise 4 / unclassified 21。新增 `unclassified` 多为打包依赖文案、GrowthBook 实验键、以及本次已移植的 team-onboarding/autofix-pr/betas 字面量（见 R7）；`noise` 来自打包依赖。

## 台账统计

- `ported`：23 个 behavior + 2 个 `cmd:` + 5 个 `env:` + 1 个 `flag:`（`flag:--thinking-display`，见 R7；`behavior:mantle-bedrock` 用 SDK 原生类后转为 ported，见 R1）。
- `approximated`：`behavior:scrollback-diff-repeat`（R2，未移植）+ 3 个 VSCode behavior（R3）+ 5 个沿用的依赖/扫描噪声 `env:`（R6）。
- 无 `unresolved`；`missingInSrc` / `unexpectedInSrc` / `unregistered` / `evidenceErrors` / `srcEvidenceErrors` / `uncoveredReleaseItems` 均为空（release 说明 1..25 全覆盖）。

## changelog 25 条对照

1. Amazon Bedrock powered by Mantle @`bundle:CLAUDE_CODE_USE_MANTLE`：`src/utils/model/providers.ts` 新增 `mantle` provider（`getAPIProvider` 顺序、`getSecondaryProvider`、按模型 `getProviderForModel`）、`src/utils/model/configs.ts` 每个模型加 `mantle` 键（haiku-4-5 为 `anthropic.claude-haiku-4-5`）、`src/services/api/client.ts` mantle 分支走 Mantle 端点；`modelStrings`/`system`（billing attestable）/`coreSchemas`/`deprecation`/`status`/`teammateModel` 同步（见 R1、R5）。
2. 默认 effort 由 medium 改为 high @`bundle:tengu_grey_step2`：`src/utils/effort.ts` 的 `getDefaultEffortForModel` 去掉 Team 的 medium 默认与无订阅门控的 ultrathink medium，ultrathink 默认仅限 Pro/Max 订阅，其余回退 high。
3. Slack MCP 紧凑 `Slacked #channel` 头 @`bundle:Slacked`/`app_redirect?channel=`：新增 `src/utils/slack/toolRendering.tsx`，并在 `src/services/mcp/client.ts` 按工具名接入。
4. 插件 output style 支持 `keep-coding-instructions` frontmatter @`bundle:keep-coding-instructions`：`loadPluginOutputStyles.ts` 解析并回传，`prompts.ts` 已消费 `keepCodingInstructions`。
5. `UserPromptSubmit` hook 支持 `hookSpecificOutput.sessionTitle` @`bundle:sessionTitle`：`src/types/hooks.ts`、`src/utils/hooks.ts`、`sessionStorage.ts` 放宽签名，`processUserInput.ts` 清洗（≤200 字符、hook 来源）并应用。
6. 插件 skill 用 frontmatter `name` 作调用名 @`bundle:SKILL.md`：`loadPluginCommands.ts` 以 frontmatter.name 规整后拼 pluginName。
7. 长 Retry-After 的 429 立即浮现 @`bundle:tengu_api_retry_after_too_long`：`withRetry.ts` 非持久分支在外部构建下 delay>60s 抛 `CannotRetryError` 并记事件。
8. macOS Console 登录钥匙串锁定错误浮现 @`bundle:Claude Code-doctor-probe`/`unlock-keychain`：`auth.ts` 保存密钥失败抛错并记事件；`doctorDiagnostic.ts` 新增钥匙串可写探测，`Doctor.tsx` 接入。
9. 插件 skill YAML frontmatter 的 hooks 不再被忽略 @`bundle:Invalid hooks in plugin skill`：`loadPluginCommands.ts` 解析 `HooksSchema` 并随命令返回 hooks/skillRoot。
10. 未设 `CLAUDE_PLUGIN_ROOT` 时插件 hook 清晰报错 @`bundle:Hook command references`：`hooks.ts` 在替换前校验 `${CLAUDE_PLUGIN_ROOT}/${CLAUDE_PLUGIN_DATA}` 引用。
11. 本地 marketplace 插件 `${CLAUDE_PLUGIN_ROOT}` 指向安装缓存 @`bundle:installed_plugins.json`：`pluginLoader.ts` 优先用 `installed_plugins.json` 的 `installPath`。
12. 长会话回滚缓冲重复 diff / 空白页 @`bundle:scrollback`（实为 `csi.ts` 的 `ED` 擦除模式枚举，非修复落点）：`ink/log-update.ts` 的 `render()` 与上一版逐 token 等价（仅压缩改名），渲染带其余差异仅为已移植的 #15/#16/#17 与打包依赖内部；无可移植的 `src/` 逻辑改动，未改动 src（见 R2）。
13. 多行用户提示续行缩进 @`bundle:❯`：`HighlightedThinkingText.tsx` 改为行内 Box + 固定宽指针列。
14. 搜索输入 Shift+Space 插入空格 @`bundle:===\"space\")return\" \"`：`ink/events/keyboard-event.ts` 当 key name 为 `space` 时返回 `" "`。
15. tmux + xterm.js 点击超链接开两个标签 @`bundle:client_termtype`：`ink/components/App.tsx` 在 TMUX 下用 `tmux display-message` 解析真实客户端终端，使 `isXtermJs` 生效。
16. alt-screen 滚动中高度变化残留鬼影行 @`bundle:DECSTBM`：`ink/render-node-to-output.ts` 第二遍渲染擦除移位后遗留的陈旧区块（`clearedTop`）。
17. `settings.json` `env` 中的 `FORCE_HYPERLINK` 被忽略 @`bundle:FORCE_HYPERLINK`：`supports-hyperlinks.ts` 在调用时用 `createSupportsHyperlinks` 重新求值并在存在 `FORCE_HYPERLINK` 时短路。
18. 对话框切 Tab 时原生终端光标未跟随 @`bundle:{line:0,column:1`：`components/design-system/Tabs.tsx` 新增 `TabHeaderItem` 用 `useDeclaredCursor` 把光标停在选中标签首字符。
19. Bedrock Sonnet 3.5 v2 用 `us.` 推理档案 ID @`bundle:us.anthropic.claude-3-5-sonnet-20241022-v2:0`：`configs.ts` 的 `CLAUDE_3_5_V2_SONNET_CONFIG.bedrock`。
20. SDK/print 模式流中断保留部分助手回复 @`bundle:partialMessage`/`APIUserAbortError`：`claude.ts` 在 `APIUserAbortError` 且 signal aborted 且 sdk 来源时，先 yield 合成 assistant 消息再抛错。
21. `--resume` 直接恢复同仓库其它 worktree 会话 @`bundle:worktree`：`crossProjectResume.ts` 删除 `USER_TYPE` 门控的 `cd` 兜底，统一走 same-repo worktree 判定。
22. stream-json 多字节被 chunk 边界切断 @`bundle:stream-json`：`main.tsx` stream-json 分支返回 `process.stdin` 前 `setEncoding('utf8')`，由 `StringDecoder` 跨 chunk 拼接。
23. [VSCode] 降低启动子进程开销 @`bundle:VSCode`：仅 VS Code 扩展侧改动，本仓库 CLI 无对应实现，未移植（见 R3）。
24. [VSCode] 修复下拉菜单选中错误项 @`bundle:vscode`：仅 VS Code 扩展侧 UI，未移植（见 R3）。
25. [VSCode] settings.json 解析失败显示警告横幅 @`bundle:settings.json`：仅 VS Code 扩展侧 UI，未移植（见 R3）。

## 验收补充（R 编号）

- R1：`behavior:mantle-bedrock` 记为 `ported`。原 `@anthropic-ai/bedrock-sdk` 0.26.4 无 `AnthropicBedrockMantle`，已升级到 1.1.3（与上游 bundle 内嵌的同类一致），`client.ts` mantle 分支直接用 `AnthropicBedrockMantle`，按 `awsRegion`/`skipAuth`（`CLAUDE_CODE_SKIP_MANTLE_AUTH`）/缓存凭证构造，`baseURL` 与 `ANTHROPIC_BEDROCK_MANTLE_BASE_URL` 由该类内部处理。bedrock-sdk 1.x 依赖 `@anthropic-ai/sdk >=1.0.0 <2`，为消除双版本已把主 `@anthropic-ai/sdk` 一并升到 1.12.0（`vertex-sdk`/`foundry-sdk` 同步到 1.x），`AnthropicBedrockMantle` 与本仓 `Anthropic` 现共用同一 SDK 主版本，顶层不再并存 `0.81.0`，返回处的 `as unknown as Anthropic` 仍保留为 bedrock-sdk ↔ 主 sdk 的真实边界断言。升级 1.x 的连带改动：`BetaUsage` 新增必填 `fallback_credit`/`output_tokens_details`（`NonNullableUsage` 对 `fallback_credit` 保持可空、`output_tokens_details` 默认 `{thinking_tokens:0}`，`updateUsage`/`accumulateUsage` 透传并累加）；`BetaMessage` 新增 `diagnostics`/`stop_details`（合成消息置 `null`）；`tool_result` 内容新增 `BrowserStateBlockParam`（并入 `MediaCandidate`/token 估算）；`temperature` 已从请求类型移除（校验用探针调用不再传，主查询路径经未标注的 `BetaMessageStreamParams` 字面量仍会透传，未改动）；`models.list` 的 `betas` 改由请求头 `anthropic-beta` 发送。此外主 SDK 1.x 把 `apiKey` 默认作为 `Authorization: Bearer` 发送（不再是 `x-api-key`）；`anthropicAws.ts` 为保留 Claude Platform on AWS 的 `x-api-key` 契约，改为把 key 放进 `defaultHeaders` 并传 `apiKey: null`，SigV4 分支不受影响。
- R2：第 12 条（长会话回滚缓冲重复 diff / 空白页）未移植，台账如实记 `approximated`。本次用标识符归一化的 Myers 对拍（消去压缩改名）复核：`ink/log-update.ts` 的 `render()` 从 `"Full reset (shrink->below)"` 到 `"Slow render:"` 整段（含 `viewportY`/`scrollbackRows` 计算、`needsFullReset` 早退、diff 循环与 cursorRestore 逻辑）两版 `eq 73 / ins 1 / del 1`，逐 token 等价；`render-node-to-output.ts` 差异仅为已移植的第 16 条（`clearedTop`）；`ink.tsx`（frame 生命周期 / onRender）区段仅含第 15 条（tmux XTVERSION）等已移植项。`bundle:scrollback` 实为 `csi.ts` 的 `ED` 擦除模式枚举 `["toEnd","toStart","all","scrollback"]`，与渲染无关，是上一次登记时的误判锚点。渲染带剩余差异均为打包依赖内部（`wrap-ansi` 新增 `Bun.wrapAnsi` 分支、`ansi-tokenize`、React reconciler 区段、彩色堆栈解析器等）。故该项修复在 2.1.94 中不体现为可移植的 `src/` 逻辑改动，最可能由 npm 依赖（reconciler/ink 内部）版本带出，属 `ignored-dependency` 性质；无可靠实现点可移植，未改动 `src/`。
- R3：第 23–25 条为 `[VSCode]` 扩展侧改动（冷启动子进程、下拉选择、settings.json 解析横幅），本仓库只有 CLI，无对应扩展代码，未移植；台账记 `approximated` 并写明原因。
- R4：两个新命令为近似实现。
  - `cmd:autofix-pr`：按上游接线 `teleportToRemote` + `registerRemoteAgentTask`（`remoteTaskType:'autofix-pr'`），`subscribe-pr` 订阅端点内联实现（2xx 与 409 均视为成功）。差异：未透传上游的 `source:"autofix_pr"` 遥测字段；`logEvent` 的 result 事件压缩为 `{success}`；`/v1/code/github/subscribe-pr` 使用 `ccr-byoc-2025-07-29` beta 头；上游对 PR 探测/订阅失败细分的错误码（`gh_failed`/`gh_not_found`/`no_open_pr`/`pr_not_open`/`not_eligible`/`bad_pr_url`/`http_413`）本仓未实现，统一以布尔 `success` 归并，故失败原因不区分。
  - `cmd:team-onboarding`：prompt 型命令，`PROMPT_TEMPLATE`/`GUIDE_TEMPLATE` 逐字移植自上游 bundle；用量扫描（slash 命令、MCP 服务器、会话描述符、`git config user.name`、当前仓库）按本地 `loadMessageLogs()` 重写。门控 `CLAUDE_CODE_TEAM_ONBOARDING` 或 GrowthBook `tengu_flint_harbor`，prompt/guide 模板可由 `tengu_flint_harbor_prompt` 覆盖。差异：本仓仅记 `_invoked`/`_generated` 遥测，未记上游的 `tengu_team_onboarding_discovery_shown`。
- R5：Mantle provider 判定已与上游逐条核对一致，无遗留补项。上游 `isFirstPartyLikeProvider`（`M2`，≈2285805）与实验性 beta 门控（`h76`，≈3446929）均只含 `firstParty`/`anthropicAws`（`h76` 另含 `foundry`），**不含** `mantle`；`usesFirstPartyModelFormat`（`ru`，≈2285870）含 `foundry`/`mantle`；工具搜索 beta 头选择 `Nuq`（≈3446926）把 `vertex`/`bedrock`/`mantle` 归为 3P 头。本仓 `isFirstPartyLikeProvider`、`shouldIncludeFirstPartyOnlyBetas`、`usesFirstPartyModelFormat` 与上游一致；本轮补齐 `getToolSearchBetaHeader` 的 `mantle → 3P` 分支（`src/utils/betas.ts`）。计费头（`system.ts` 的 `cch=00000` 排除 `mantle`）、`utils/status.tsx` 的 Mantle/区域诊断、`coreSchemas` 的 `apiProvider` 枚举均已含 `mantle`，与上游同。
- R6：五个依赖/扫描噪声 `env:`（`CLAUDE_CODE_HOST_HTTP_PROXY_PORT`、`CLAUDE_CODE_HOST_SOCKS_PROXY_PORT`、`CLAUDE_CODE_RESUME_THRESHOLD_MINUTES`、`CLAUDE_CODE_RESUME_TOKEN_THRESHOLD`、`CLAUDE_CODE_SM_COMPACT`）沿用 2.1.92 结论，偏移刷新到 2.1.94 bundle；`src/` 不直接读取。
- R7：字符串分诊。新增 `unclassified` 82 条经回查：GrowthBook 实验键（如 `tengu_flint_harbor*`、memory/advisor 相关）、team-onboarding/autofix-pr 已移植字面量、内容与系统提示模板、XML/JSON 解析器错误文案、依赖内部文案等；移除 `unclassified` 21 条为旧版文案/依赖残余。此外，目标 bundle 的隐藏 CLI flag `--thinking-display <display>`（`summarized`/`omitted`，写请求 `thinking.display`）属 `inventory` 漏收、也不在 25 条 release 说明内，本轮按上游补移植：`src/main.tsx` 加 option 并在 thinking 推导后设置 `thinkingConfig.display`（`g4.type!=="disabled"` 时），`src/services/api/claude.ts` 把它拷到请求 `thinking.display`，`src/utils/thinking.ts` 新增 `ThinkingDisplay` 类型；台账 `flag:--thinking-display`（`ported`，`bundle:` 偏移 13186607/13209309）。其余未命中 release 说明的 `unclassified` 不移植（不在 25 条范围内）。

## 交叉验证（§1.5）

- `table --whole`：2.1.94 目标 bundle vs `src/tools/PowerShellTool/readOnlyValidation.ts#CMDLET_ALLOWLIST` 的 PowerShell cmdlet 允许表 **0 added / 0 removed / 0 changed**；本版未触及白名单/安全表。
- `strings`：见「增量范围」与 R7。
- `refresh-evidence --fail-on-skipped`：`updated 0 / skipped 0`，所有 `bundle:` 偏移在 2.1.94 bundle 中仍有效。
- `verify`（strict）：`ok=true`，六类错误清单全空，release items 1..25 全覆盖。
- `gates --ref HEAD --gate typecheck,lint`：0 new finding（基线无新增 typecheck/lint 报错）。

## 验收命令

```bash
# 台账闭合（strict：证据 + srcEvidence + releaseItems 覆盖）
bun scripts/upgrade/cli.ts verify \
  --target /tmp/upgrade-2.1.94/package-2.1.94/package/cli.js \
  --reference /tmp/upgrade-2.1.92/package-2.1.92/cli.js \
  --src src --status docs/upgrade/2.1.94/status.json --out docs/upgrade/2.1.94 \
  --release-notes /tmp/upgrade-2.1.94/work/releasenotes/notes.json --strict-evidence

# 交叉验证：release 说明 → strings 分诊 → 常量表对拍 → 证据刷新 → 基线门禁
bun scripts/upgrade/cli.ts strings \
  --target-inventory /tmp/upgrade-2.1.94/work/inventory-2.1.94.json \
  --reference-inventory /tmp/upgrade-2.1.92/work/inventory-2.1.92.json --src src \
  --release-notes /tmp/upgrade-2.1.94/work/releasenotes/notes.json --out /tmp/upgrade-2.1.94/work/strings-2.1.94
bun scripts/upgrade/cli.ts table --bundle /tmp/upgrade-2.1.94/package-2.1.94/package/cli.js \
  --anchor get-date --whole \
  --src src/tools/PowerShellTool/readOnlyValidation.ts#CMDLET_ALLOWLIST --out /tmp/upgrade-2.1.94/work/table-src.json
bun scripts/upgrade/cli.ts refresh-evidence --target /tmp/upgrade-2.1.94/package-2.1.94/package/cli.js \
  --status docs/upgrade/2.1.94/status.json --out /tmp/upgrade-2.1.94/work/status-refreshed.json --in-place --fail-on-skipped
bun scripts/upgrade/cli.ts gates --ref HEAD --gate typecheck,lint --out /tmp/upgrade-2.1.94/work/gates --fail-on-new
```
