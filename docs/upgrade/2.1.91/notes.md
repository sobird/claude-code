# 2.1.91 近似实现与未解点

台账：`docs/upgrade/2.1.91/status.json`（reference 2.1.90 → target 2.1.91）。产物位于 `/tmp/upgrade-2.1.91/`：`package-2.1.91/cli.js`（2.1.91）、`ref-2.1.90/cli.js`（2.1.90）、`work/inventory-2.1.9{0,1}.json`、`work/align-2.1.91/align.json`（首轮）、`work/align-scored/align.json`（打分配对复跑）、`work/candidates-2.1.91/`、`work/strings-2.1.91/`、`work/releasenotes/notes.json`、`work/table-*.json`、`work/refresh-2.1.91.json`、`work/gates-2.1.91/`、`work/verify-final/`。文中偏移均为解码后字符偏移。

## 增量范围

inventory 对拍（2.1.90 → 2.1.91）结果：

- 命令：新增 `ultraplan`（local-jsx）；移除 `output-style`（local-jsx）。
- `CLAUDE_CODE_*`：移除 `CLAUDE_CODE_MCP_INSTR_DELTA`；无新增。
- CLI flag：无变化。
- 字符串：首轮扫描给出新增 329 / 移除 252，这一版的字符串扫描器在正则（`=>` 后接含引号/反引号的正则）处失步，把大片代码误判成字面量。修复扫描器并改用 `strings` 子命令分诊后，真实差集是**新增 123 / 移除 43**：新增中 `inSrc` 84、`releaseNotes` 20、`noise` 3、`unclassified` 16；移除中 `inSrc` 18、`releaseNotes` 14、`noise` 1、`unclassified` 10。`inSrc`/`releaseNotes` 已覆盖本版 13 条 changelog 与源码里已有的文案；`noise` 来自打包依赖（proxy-agent / axios / ajv / `@smithy/*` / `@aws-sdk/*` / GrowthBook SDK / `@anthropic-ai/sandbox-runtime`）；16 条 `unclassified` 逐条回 bundle 看上下文后均为上游 UI 文案（web 登录、设备信任、plan UI、时区/base64 数据），本仓库无对应路径，不移植。可移除项已在 R4 中处理。

台账只有 5 个 `env:` 条目为 `approximated`（沿用 2.1.90 的依赖噪声结论，本版无变化），其余均为 `ported` 或 `already-present`。

## 近似实现

### 五个沙箱/提示类环境变量（`approximated`）

- `CLAUDE_CODE_HOST_HTTP_PROXY_PORT` @`bundle:4362458`、`CLAUDE_CODE_HOST_SOCKS_PROXY_PORT` @`bundle:4362536`：由打包依赖 `@anthropic-ai/sandbox-runtime` 在 Linux 沙箱启动时注入子进程。本仓库该能力由同名依赖提供，`src/` 不直接读取，因此无法给出源码读取点。
- `CLAUDE_CODE_RESUME_THRESHOLD_MINUTES` @`bundle:12407389`、`CLAUDE_CODE_RESUME_TOKEN_THRESHOLD` @`bundle:12407453`：resume-return 提示的阈值（默认 70 分钟 / 100000 tokens），由 GrowthBook `tengu_gleaming_fair` + `resumeReturnDismissed` 门控。本仓库没有该提示机制，仅登记不移植。
- `CLAUDE_CODE_SM_COMPACT` @`bundle:9518882`：扫描器 `ENV_RE` 从 `ENABLE_/DISABLE_CLAUDE_CODE_SM_COMPACT` 截出的子串名；真实读取点在 `src/services/compact/sessionMemoryCompact.ts`（带前缀的两个变量），属于扫描噪声。

## changelog 13 条对照

官方 v2.1.91 release 说明共 13 条，逐条回目标 bundle 定位并与本仓库实现对照：

1. MCP 结果持久化上限注解 `_meta["anthropic/maxResultSizeChars"]`（至 500K）@`bundle:6914190`/`5057197`：`src/services/mcp/client.ts` 读取注解并传 `MCP_RESULT_SIZE_CEILING`，`src/Tool.ts` 新增 `persistenceThresholdCeiling`，`src/utils/toolResultStorage.ts` 的 `getPersistenceThreshold` 接受 ceiling，`src/services/tools/toolExecution.ts` 透传。
2. `disableSkillShellExecution` @`bundle:1047152`/`8686406`：`src/utils/settings/types.ts` 新增布尔设置，`src/utils/promptShellExecution.ts` 读取策略（`policySettings` 优先）并替换为 `DISABLED_PLACEHOLDER`。
3. 深链接 `claude-cli://open?q=` 多行提示 @`bundle:1055897`/`9941131`：`src/utils/deepLink/parseDeepLink.ts` 增加 `allowNewlineAndTab`，CRLF 归一为 LF，放行 `%0A`/`%09`。
4. 插件 `bin/` 可执行文件 @`bundle:9701789`/`8548421`：`src/utils/bash/ShellSnapshot.ts` 懒加载 `loadAllPluginsCacheOnly`，把启用插件（非 builtin）的 `bin/` 追加到快照 PATH（追加而非前置，Windows 走 `windowsPathToPosixPath`）。
5. `--resume` 异步写失败导致会话链断裂 @`bundle:11379591`：`src/utils/sessionStorage.ts` 的 `buildConversationChain` 在 `parentUuid` 缺失时用 `findClosestPreviousMessage`（5 秒窗口）兜底，并上报 `tengu_chain_timestamp_fallback`。
6. `cmd+delete` 删除到行首 @`bundle:9873954`/`9874053`：`src/hooks/useTextInput.ts` 的 backspace 分支新增 `key.super → killToLineStart`、delete 分支新增 `key.super → killToLineEnd`。
7. 远端容器重启后 plan 文件丢失 @`bundle:8391256`/`9087508`：CLI 侧机制逐字符一致，见 R3（`already-present`）。
8. `permissions.defaultMode: "auto"` 的 JSON schema 校验 @`bundle:997069`/`1039753`：`src/types/permissions.ts` 的 `EXTERNAL_PERMISSION_MODES` 纳入 `'auto'`（上游 `qw8=["acceptEdits","auto",…,"plan"]`，`InternalPermissionMode` 不再单列 `auto`），`src/utils/settings/types.ts` 的 `defaultMode` 改为无条件 `z.enum(PERMISSION_MODES)`，`src/utils/permissions/PermissionMode.ts` 的 `isExternalPermissionMode` 改为 `mode !== 'bubble'`。同一条链路上还有两处必须同步，否则 typecheck 报错：`src/entrypoints/sdk/coreSchemas.ts` 的 `PermissionModeSchema` 枚举/describe 加入 `'auto'`（上游 SDK 枚举 `["default","acceptEdits","bypassPermissions","plan","dontAsk","auto"]`，mailbox 的权限模式类型走该 schema）；`src/types/permissions.ts` 移除因上述改写而闲置的 `feature` 导入。
9. Windows 版本清理保护运行中版本的回滚副本 @`bundle:10335182`：`src/utils/nativeInstaller/installer.ts` 的 `VersionInfo` 增加 `size`；`readlink` 探测不到当前版本时按活动可执行文件大小匹配并加入 `protectedVersions`。
10. `/feedback` 解释不可用原因 @`bundle:9916271`/`7020595`：`src/commands/feedback/feedback.tsx` 新增 `getFeedbackUnavailableReason`（Bedrock/Vertex/Foundry、两个 DISABLE 变量、essential-traffic、`allow_product_feedback` 策略），`src/commands/feedback/index.ts` 改为 `isEnabled: () => true`。
11. `/claude-api` agent 设计指导 @`bundle:12754405`/`12748194`/`12744762`：新增 `src/skills/bundled/claude-api/shared/agent-design.md`，`SKILL.md` 的 Reading Guide 增加 Agent design 快捷项与文件清单条目，effort 说明改为 medium/max/low 的取舍；`claudeApiContent.ts` 注册新文件，`claudeApi.ts` 的内联阅读指南同步。加载器差异见 R2。
12. Bun 上 `stripAnsi` 走 `Bun.stripANSI` @`bundle:162419`：新增 `src/utils/stripAnsi.ts`（优先 `Bun.stripANSI`，否则回退 `strip-ansi` 包），`QueryEngine.ts`、`mappers.ts`、`useTextInput.ts` 等调用点改用封装。
13. Edit 工具更短的 `old_string` 锚点 @`bundle:8706541`：`src/tools/FileEditTool/prompt.ts` 由 GrowthBook `tengu_edit_minimalanchor_jrn` 切换文案（1-3 行、只需唯一即可），属灰度实验项，见 R6。

## 验收补充（R 编号）

- R1：ultraplan 运行时门控。2.1.91 新增 `tengu_ultraplan_config` @`bundle:10892745`，上游 `enabled` 默认 `false`。本仓库新增叶子模块 `src/utils/ultraplan/enabled.ts`，默认 `{ enabled: true }` 以保持离线可用；调用点（`processUserInput.ts`、`PromptInput.tsx`、`ExitPlanModePermissionRequest.tsx`、`commands/ultraplan.tsx`）同时与编译期 `feature('ULTRAPLAN')` 组合，外部构建仍不包含该命令。该默认值与上游相反，是有意近似。
- R2：`/claude-api` 技能的本地加载器与上游不同。上游把 `<!-- __S3__ -->` 之类标记和文件清单内联在 `SKILL_PROMPT` 里；本仓库 `claudeApi.ts` 的 `buildPrompt` 在 `## Reading Guide` 处截断，再用 `INLINE_READING_GUIDE` 与外置 `SKILL_FILES` 重排。为保证两条路径一致，本版在 `SKILL.md`（全量清单）与 `INLINE_READING_GUIDE`（快捷项）各加一条，未添加上游的 `__S3__` 标记（在本仓库加载器里无意义，添加反而会残留进提示词）。`agent-design.md` 内容按上游内嵌字符串逐字节复制。
- R3：`bundle-only:plan-file-remote-restart` 记为 `already-present`。对比 2.1.90/2.1.91 bundle，CLI 侧相关机制（`copyPlanForResume` 的 resume 恢复、`persistFileSnapshotIfRemote` 的 `file_snapshot` 落盘、`normalizeToolInput` 为 `ExitPlanMode` 注入 `plan`/`planFilePath`）逐字符一致，差异仅来自压缩变量名；该修复落在容器/CCR 侧，`src` 中机制已具备，无需改动。
- R4：上游删除项同步删除，删除即移植。①`/output-style` 命令：删除 `src/commands/output-style/`，清理 `src/commands.ts` 与 `src/commands/clear/caches.ts` 的注册/缓存引用；output styles 配置子系统（`src/constants/outputStyles.ts` 等）上游仍保留，未动。②`CLAUDE_CODE_MCP_INSTR_DELTA` 与 `tengu_basalt_3kr`：上游不是只删环境变量，而是整条门控全链路消失——确认 2.1.91 中 `mcp_instructions_delta` 附件构建不再有 gate（@`bundle:9569815` 附近），系统提示里的静态 `mcp_instructions` 段与每请求 chrome 注入也一并消失。本仓库相应删除 `isMcpInstructionsDeltaEnabled`、`getMcpInstructionsSection`、`getSystemPrompt` 的 `mcpClients` 参数，以及 `queryModel` 里的`injectChromeHere` 分支；delta 附件改为无条件生成。参数收窄后同步处理了调用方：`fetchSystemPromptParts` 移除 `mcpClients`（上游 `P27` 同样只剩三参），`btw.tsx`、`compact.ts`、`QueryEngine.ts`、`sideQuestion` 构造器不再传该参数；`mcpClients` 仍保留在 `QueryEngine`/`cacheSafeParams` 中供 coordinator userContext 使用。③`/pr-comments` 桩（`src/commands/pr_comments/`）与 MagicDocs 服务（`src/services/MagicDocs/`）在 2.1.91 bundle 中已无对应注册/字符串，删除。
- R5：`/feedback` 的不可用判断依赖本仓库既有的 `isEssentialTrafficOnly`、`isPolicyAllowed`、`ISSUES_URL` 等辅助函数，判定顺序与上游一致，但策略后端是本地实现；`isEnabled: () => true` 保证命令始终出现在菜单里。
- R6：GrowthBook 灰度项（`tengu_edit_minimalanchor_jrn`、`tengu_ultraplan_config`、`tengu_ultraplan_stopped`、`tengu_chain_timestamp_fallback`、`tengu_relpath_gh7k` 等）无法在离线环境驱动，验收证据为静态偏移 + 默认值分支；未登记为 `approximated` 的条目在取默认值时行为与上游未命中灰度时一致。
- R7：端到端不可覆盖的薄项。Windows 版本清理（R9 条目的实现）只在 Windows 生效，macOS 上仅能靠类型检查与代码对照；transcript 时间窗兜底需要构造磁盘链断裂，未加 E2E；`Bun.stripANSI` 路径在 Bun 下可用、Node 下回退，行为与上游封装等价。
- R8：ultraplan 系列行为（`tengu_ultraplan_stopped`、`Terminated` 文案与 `task-notification`、按分钟的超时文案、冠词修正、远端元数据清理、命令描述 getter）与上游逐处对照移植；因依赖 CCR 远端会话，验收证据为 `bundle:` 偏移，无法本地跑通。

## 交叉验证：PowerShell 常量表（§1.5）

对 2.1.90/2.1.91 两版 bundle 抽取 `"get-date":{safeFlags…` 所在的 cmdlet 允许表：

- 2.1.90 与 2.1.91 各 84 项，按 `safeFlags`（小写归一）、回调存在性、条目 key 集合逐项对拍，**0 差异**。
- 与 `src/tools/PowerShellTool/readOnlyValidation.ts` 的 `CMDLET_ALLOWLIST` 对拍，同样 **0 差异**。
- 回调门控跨表不变量：`CMDLET_ALLOWLIST` 中带 `additionalCommandIsDangerousCallback` 的 18 项与 `src/utils/powershell/dangerousCmdlets.ts` 的 `ARG_GATED_CMDLETS` 完全一致（双向无缺、无多）。
- 本版没有对白名单条目的改名或回调改名，2.1.90 的 `arp`/`ipconfig` 结论继续有效。

## 进化后流水线复跑

用新增的辅助子命令把上面的手工步骤跑成可复现脚本（产物在 `/tmp/upgrade-2.1.91/work/`）：

- `releasenotes --version v2.1.91`：解析出 13 条顶层条目（`releasenotes/notes.json`）。台账 20 个 `behavior:` 条目的 `releaseItems` 覆盖说明 1–13，`verify` 的 `uncoveredReleaseItems` 为空。
- `table --whole`：2.1.90 vs 2.1.91 的 cmdlet 允许表（84 项）、2.1.91 vs `src` 的 `CMDLET_ALLOWLIST` 均为 0 差异（`table-2.1.90-to-2.1.91.json` 三个数组全空），替代原先的 `bun -e` 手工 dump。
- `strings`：新增 123（84/20/3/16）、移除 43（18/14/1/10），见「增量范围」。
- `refresh-evidence`：`updated 0 / skipped 0`，所有 `bundle:` 偏移在 2.1.91 bundle 中仍有效。
- `gates --ref HEAD --fail-on-new`：typecheck `0 added / 0 removed`（基线本身有存量错误，两边同为 exit 2）、lint `0 added / 5 removed`（R4 删除 `/output-style`、MagicDocs 等留下）、test `0 added / 0 removed`（基线在临时 worktree 缺环境时有 1 条失败，工作区无新增）。首轮未归一化时报出 2597 条伪差异，归一化行/列、根路径、耗时、依赖顺序、lint 代码框与 `(fail)` 过滤后收敛到 0。
- `align` 的 `changed` 配对改为按字符串字面量重叠（Jaccard）+ 相对位置打分，不再取同 kind 的第一个候选。用同一组输入重跑（`align-scored/`）与首轮（`align-2.1.91/`）相比：分类计数完全一致（unattributed 55741 / new 87），但有 **397 个目标函数改配到了更相似的参考函数**（`reference.start` 变化，`confidence`/`classification` 不变），即在不改动台账语义的前提下提高了归属精度。
- `verify`（strict）：`ok=true`，`evidenceErrors` / `srcEvidenceErrors` / `uncoveredReleaseItems` 均空。

## 台账说明

- 五个 `env:` 条目沿用 2.1.90 的近似结论（依赖噪声/扫描子串），2.1.91 未变化，偏移已刷新到 2.1.91 bundle。
- `status.json` 的 `behavior:` 条目不属于命令/env 的自动判定范围，但 `verify` 会校验其 `evidence` 与 `srcEvidence`（文件存在、符号在文件里出现），并通过 `releaseItems` 检查 release 说明覆盖度；这三类错误当前均为空。

## 验收命令

```bash
# 台账闭合（strict：证据 + srcEvidence + releaseItems 覆盖）
bun scripts/upgrade/cli.ts verify \
  --target /tmp/upgrade-2.1.91/package-2.1.91/cli.js \
  --reference /tmp/upgrade-2.1.91/ref-2.1.90/cli.js \
  --src src --status docs/upgrade/2.1.91/status.json --out docs/upgrade/2.1.91

# 交叉验证：release 说明 → strings 分诊 → 常量表对拍 → 证据刷新 → 基线门禁
bun scripts/upgrade/cli.ts releasenotes --version v2.1.91 --out /tmp/upgrade-2.1.91/work/releasenotes/notes.json
bun scripts/upgrade/cli.ts strings \
  --target-inventory /tmp/upgrade-2.1.91/work/inventory-2.1.91.json \
  --reference-inventory /tmp/upgrade-2.1.91/work/inventory-2.1.90.json --src src \
  --release-notes /tmp/upgrade-2.1.91/work/releasenotes/notes.json --out /tmp/upgrade-2.1.91/work/strings-2.1.91
bun scripts/upgrade/cli.ts table --bundle /tmp/upgrade-2.1.91/package-2.1.91/cli.js \
  --anchor get-date --whole \
  --src src/tools/PowerShellTool/readOnlyValidation.ts#CMDLET_ALLOWLIST --out /tmp/upgrade-2.1.91/work/table-2.1.91-src.json
bun scripts/upgrade/cli.ts refresh-evidence --target /tmp/upgrade-2.1.91/package-2.1.91/cli.js \
  --status docs/upgrade/2.1.91/status.json --in-place
bun scripts/upgrade/cli.ts gates --ref HEAD --repo-root . --out /tmp/upgrade-2.1.91/work/gates-2.1.91 --fail-on-new
```
