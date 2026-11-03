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

## 未解点
