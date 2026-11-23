# 2.1.94 近似实现与未解点

台账：`docs/upgrade/2.1.94/status.json`（reference 2.1.92 → target 2.1.94）。产物位于 `/tmp/upgrade-2.1.94/`：`package-2.1.94/package/cli.js`（2.1.94）、`package-2.1.92/cli.js`（2.1.92，参照）、`work/inventory-2.1.9{2,4}.json`、`work/align-2.1.94/`、`work/strings-2.1.94/`、`work/releasenotes/notes.json`、`work/table-src.json`、`work/report/`、`work/status-refreshed.json`、`work/gates/`。文中偏移均为解码后字符偏移。

## 增量范围

inventory 对拍（2.1.92 → 2.1.94）结果：

- 命令：新增 `autofix-pr`、`team-onboarding`；无移除。
- `CLAUDE_CODE_*`：新增 `CLAUDE_CODE_MCP_ALLOWLIST_ENV`、`CLAUDE_CODE_SANDBOXED`、`CLAUDE_CODE_SKIP_MANTLE_AUTH`、`CLAUDE_CODE_TEAM_ONBOARDING`、`CLAUDE_CODE_USE_MANTLE`；无移除。
- CLI flag：无增删。
- 字符串：`strings` 分诊后新增 inSrc 97 / releaseNotes 132 / noise 6 / unclassified 82；移除 inSrc 39 / releaseNotes 15 / noise 4 / unclassified 21。新增 `unclassified` 多为打包依赖文案、GrowthBook 实验键、以及本次已移植的 team-onboarding/autofix-pr/betas 字面量（见 R7）；`noise` 来自打包依赖。

## 台账统计

- `ported`：22 个 behavior + 2 个 `cmd:` + 5 个 `env:`。
- `approximated`：`behavior:mantle-bedrock`（R1）+ `behavior:scrollback-diff-repeat`（R2，未移植）+ 3 个 VSCode behavior（R3）+ 5 个沿用的依赖/扫描噪声 `env:`（R6）。
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
12. 长会话回滚缓冲重复 diff / 空白页 @`bundle:scrollback`：纯逻辑改动、无新增字面量，未能在本地 bundle 定位可靠实现，未改动 src（见 R2）。
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

- R1：`behavior:mantle-bedrock` 记为 `approximated`。已安装的 `@anthropic-ai/sdk` 0.81.0 / `@anthropic-ai/bedrock-sdk` 0.26.4 均无 `AnthropicBedrockMantle` 类，`client.ts` 改用 `AnthropicBedrock` + `baseURL`（默认 `https://bedrock-mantle.<region>.api.aws/anthropic`，可用 `ANTHROPIC_BEDROCK_MANTLE_BASE_URL` 覆盖）实现，SigV4 签名路径与上游一致；`CLAUDE_CODE_SKIP_MANTLE_AUTH` 时置 `skipAuth`。差异仅在客户端类名与构造参数形态，网络协议与鉴权行为对齐。
- R2：第 12 条（长会话回滚缓冲重复 diff / 空白页）未移植。该改动为纯逻辑（无新增字面量），本地 minified bundle 无法定位到可靠实现点，证据仅有 `bundle:scrollback` 关键词；未改动 `src/`，台账如实记 `approximated`。
- R3：第 23–25 条为 `[VSCode]` 扩展侧改动（冷启动子进程、下拉选择、settings.json 解析横幅），本仓库只有 CLI，无对应扩展代码，未移植；台账记 `approximated` 并写明原因。
- R4：两个新命令为近似实现。
  - `cmd:autofix-pr`：按上游接线 `teleportToRemote` + `registerRemoteAgentTask`（`remoteTaskType:'autofix-pr'`），`subscribe-pr` 订阅端点内联实现（2xx 与 409 均视为成功）。差异：未透传上游的 `source:"autofix_pr"` 遥测字段；`logEvent` 的 result 事件压缩为 `{success}`；`/v1/code/github/subscribe-pr` 使用 `ccr-byoc-2025-07-29` beta 头。
  - `cmd:team-onboarding`：prompt 型命令，`PROMPT_TEMPLATE`/`GUIDE_TEMPLATE` 逐字移植自上游 bundle；用量扫描（slash 命令、MCP 服务器、会话描述符、`git config user.name`、当前仓库）按本地 `loadMessageLogs()` 重写。门控 `CLAUDE_CODE_TEAM_ONBOARDING` 或 GrowthBook `tengu_flint_harbor`，prompt/guide 模板可由 `tengu_flint_harbor_prompt` 覆盖。
- R5：Mantle 的 provider 判定未全量铺开。`usesFirstPartyModelFormat` 已含 `mantle`（`effort.ts` 等按模型走），但 `isFirstPartyLikeProvider` 仍只含 `firstParty`/`anthropicAws`，因此 `src/utils/thinking.ts`（thinking/tool-search 的 1P/3P 分支）与 `src/constants/betas.ts` 的 provider 门控对 mantle 仍按第三方处理。上游若对 mantle 有专属 beta/thinking 分支，需在后续版本补；本版 release 说明未要求，故不扩散改动范围。
- R6：五个依赖/扫描噪声 `env:`（`CLAUDE_CODE_HOST_HTTP_PROXY_PORT`、`CLAUDE_CODE_HOST_SOCKS_PROXY_PORT`、`CLAUDE_CODE_RESUME_THRESHOLD_MINUTES`、`CLAUDE_CODE_RESUME_TOKEN_THRESHOLD`、`CLAUDE_CODE_SM_COMPACT`）沿用 2.1.92 结论，偏移刷新到 2.1.94 bundle；`src/` 不直接读取。
- R7：字符串分诊。新增 `unclassified` 82 条经回查：GrowthBook 实验键（如 `tengu_flint_harbor*`、memory/advisor 相关）、team-onboarding/autofix-pr 已移植字面量、内容与系统提示模板、XML/JSON 解析器错误文案、依赖内部文案等；移除 `unclassified` 21 条为旧版文案/依赖残余。除已在 release 说明范围内者外不移植（不在 25 条范围内）。

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
