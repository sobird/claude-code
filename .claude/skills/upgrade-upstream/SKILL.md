---
name: upgrade-upstream
description: Port a new upstream Claude Code release into this repo's hand-written src/ using the scripts/upgrade pipeline (inventory → align → extract → probe → verify). Use this skill whenever the user mentions upgrading or 同步上游版本, wants to follow up a new official release or bundle, asks to close out docs/upgrade/<version>/ (status.json, notes.md, report.md), or asks what still differs from upstream — even if they don't name the pipeline.
---

# 上游版本升级

本仓库的 `src/` 是手写源码，官方发布物是压缩后的 `cli.js`。升级分两段：

- **A. 建立基线与证据**：`inventory → align → extract → probe`
- **B. 移植并闭合台账**：改 `src/` → 登记 `status.json` → `verify` 退出码 0

命令和 flag 的权威来源是 `bun scripts/upgrade/cli.ts --help` 与根 `README.md` 的「如何用流水线升级版本」一节；下文只写顺序、约定和坑。开工前先跑一次 `--help`，避免和代码漂移。

## 0. 准备

- 目标版本 bundle（如 `package/cli.js`）、上一版本 bundle（对照基线）、可选 source map。
- 目标版本官方 release 说明：`https://github.com/anthropics/claude-code/releases/tag/v<版本>`，流水线跑完后逐条对拍（见 1.5）。
- 新建 `docs/upgrade/<新版本>/`，所有产物放这里（参考 `docs/upgrade/2.1.89/`）。
- 先读上一版本的 `status.json` 和 `notes.md`：沿用台账格式、id 前缀和 R# 编号习惯。
- 开工前先和用户确认范围：哪些能力要移植，哪些允许 `ignored-dependency`。
- 探查场景参考 `scripts/upgrade/scenarios/`。最小形态是 `{"args":["--version"],"breakpoints":[],"capture":[]}`；断点需要 `script`（bundle 的 basename）、`line`、`column`、`label`，`capture` 可取 `args` / `return` / `fn.toString`。

## 1. 五步流水线

| 步骤                                                       | 产物               | 用途                                                                          |
| ---------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `inventory --bundle --out`                                 | `inventory.json`   | 版本号、命令、`CLAUDE_CODE_*`、CLI flag、字符串                               |
| `align --reference --target [--map] [--prior-align] --out` | `align.json`       | AST 函数级对齐；有 map 才有 high 置信度，无 map 用 `--prior-align` 继承旧归属 |
| `extract --align --target [--keywords] --out`              | `candidates/`      | 切出待移植片段，人工阅读                                                      |
| `probe --target --scenario --out`                          | `trace.json`       | 用 `scenarios/*.json` 断点采集运行时证据                                      |
| `verify --target --reference --src --status --out`         | `report.{md,json}` | 对拍 bundle 与 `src/`，校验台账闭合                                           |

`align.json` 的节点有 `classification`（`matched` / `changed` / `new`，另有 `ignored-dependency` / `unattributed`）和 `confidence`；移植对象主要从 `changed` 和 `new` 里挑。

`verify` 退出码 0 才代表完成。`ok=false` 时逐项处理 `missingInSrc` / `unexpectedInSrc` / `unregistered` / `unresolved`。

## 1.5 交叉验证（release 说明 + 结构化常量表）

`inventory` / `align` / `extract` 只覆盖命令、env、flag 与字符串的增删。两处盲区必须手工补，`verify` 绿了也不代表没有漏项。

### 官方 release 说明

取 `https://github.com/anthropics/claude-code/releases/tag/v<目标版本>` 的更新说明，逐条当作待移植候选：

- 每条都回目标 bundle 定位实现（`bundle:<偏移>` 写进 evidence），并和参考版逐行对照语义，不要只命中字符串。
- 说明里的「行为类」条目（过滤条件、重试、退出码、表格数据）通常不在 inventory 里，是漏项高发区。
- 无法移植的条目（UI/性能优化、打包依赖内部、本仓库没有的功能前提）在 `notes.md` 写明原因，不伪造实现。

### 结构化常量表

对象字面量里的表项改动（如 PowerShell 只读允许表的 `safeFlags` / 回调）和常量数组追加（如公共参数集）不会进 inventory——值本身不是新增字符串，`verify` 也看不到。收尾必做两步：

1. 参考版 vs 目标版：抽出同一张表做 diff，得到本版的真实变更集合（别只看 release 说明）。
2. 目标版 vs `src`：用 `bun -e` 导入对应导出（如 `CMDLET_ALLOWLIST`）dump 成 JSON，与从 bundle 抽出的表逐项对拍 keys / flags / 回调存在性。

定位与判定：

- minified 变量名每版都变（如 `FYK`→`B$K`、`nX`→`YP`），用锚点字面量（如 `"get-date":{safeFlags`）或访问函数（如 `$az`→`B$K`）反查，别按变量名找。
- 用字符串感知的括号配对截出对象，再按顶层条目解析。
- 缺失 = 漏移植；多出 = 有意保留或上游未同步（写进 notes）。
- 疑似改名先比函数体/返回值：逐字符相同即纯改名，不登记为行为变更。

## 2. 台账约定

权威实现：`scripts/upgrade/verify.ts` 与 `scripts/upgrade/types.ts`。

状态语义：

- `already-present`：目标版本新增的面，`src` 里本来就有，无需改动。
- `ported`：本次完成移植。
- `approximated`：已移植但行为近似，必须在 `notes.md` 写明差异和原因。
- `ignored-dependency`：差异来自打包依赖（如 sandbox-runtime）。它只对 `flag:` / `str:` 和自建 `bundle-only:` 条目跳过判定；若用在目标版新增的 `cmd:` / `env:` 上，仍会进 `missingInSrc`。
- `retained-internal`：上游没有或已删除，但本仓库有意保留。
- `unresolved`：未解决。任意一条为它，`verify` 必然失败，不能当完成态。

判定规则（来自 `verify.ts`）：

- 目标版新增的 `cmd:` / `env:` 若不在 `src`，必须登记且状态为 `ported` / `approximated`，否则进 `missingInSrc`。
- 参考版有、目标版没有、但 `src` 仍存在的 `cmd:` / `env:`，必须登记为 `already-present` / `retained-internal`，否则进 `unexpectedInSrc`。
- `flag:` / `str:` 按「属于哪个 bundle」分类，不看 `src`；`ignored-dependency` 跳过。
- 只有 `cmd:` / `env:` 的差异会自动报 `unregistered`（有差异但没登记）。新的 `flag:` 或字符串不登记就不会报——想纳入验收的项要手动登记。
- 任意登记条目为 `unresolved`，直接进报告的 `unresolved` 并让 `ok=false`。

证据格式（`evidence` 数组）：

- `bundle:<字符串>`、`bundle:<解码后字符偏移>`（如 `bundle:9937634`；用 `fs.readFileSync(path,'utf8')` + `indexOf` 得到，不是字节偏移）
- 缺失证明：`bundle:absent:<值>`、`bundle:no-name:"<值>"`
- `scenario:<scenario 文件名>`；有测试钉住行为时加 `test:<测试路径>`

id 前缀：`cmd:` / `env:` / `flag:` / `str:`；非 inventory 类问题用 `bundle-only:<主题>` 并写清说明。
`notes.md` 每条近似实现一段；验收阶段的额外妥协用 `R<编号>` 追加记录，沿用已有编号，不要重排。

## 3. 常见坑

- slash 命令不出现在 `--help`，用 `--version` 场景 probe 会得到空 trace，这是正常现象。验收改为：`scripts/config.ts` 的 `features` 含对应 flag + 构建后 external `dist/cli.js` 含命令描述字符串。
- 不稳定的运行时功能（GrowthBook、MCP 服务器、OAuth、claude.ai 端点）probe 无法驱动，改用静态偏移作证据，并在 `notes.md` 记 R 条目。
- `verify` 只读 `src/` 下的 `.ts`/`.tsx`（`readSources`）。把证据写进文档或 JSON 不会让检查通过，该在代码里出现的东西必须真的在代码里。
- feature flag 必须字面量写成 `feature('NAME')` 且直接位于 if/三元条件中，否则 tree-shaking 失效。
- 相对导入用 `.js` 后缀；格式由 oxfmt 决定，生成的 `report.md` 也要过 `fmt:check`。
- 无 source map 时对齐置信度只有 medium/low；跨版本用 `--prior-align` 继承上一轮对齐结果。
- `verify` 默认 `--reference cli.js`，别忘了显式传上一版本 bundle。
- probe 会真实启动 bundle（node inspector + `ws`），场景里的断点行号是 bundle 里的位置，不是源码行号。
- 一处表项变更常带同族联动：安全动作参数白名单同时改了公共参数集（4 个短别名并入 `x$K`）。只按 release 说明标题移植会窄一圈——移植时抽上游整段 diff，别只抽标题命中的字符串。
- 仓库有跨表不变量：`CMDLET_ALLOWLIST` 里每个带 `additionalCommandIsDangerousCallback` 的条目，必须在 `src/utils/powershell/dangerousCmdlets.ts` 的 `ARG_GATED_CMDLETS`（进而 `NEVER_SUGGEST`）里，否则权限对话框会建议 `cmd:*` 通配、永久绕过回调。新增回调必须同步并跑一致性断言。
- `verify` 只证明台账闭合，不证明行为等价；安全相关改动按 TDD 先写失败测试。

## 4. 门禁

1. **开工前**：范围与预计状态清单经用户确认；拿不准的条目记 `unresolved`，不要猜状态让它变绿。
2. **每批改动后**：对改动文件运行 `verify` skill 的四项检查（typecheck / fmt:check / lint / test）。
3. **收尾**：`verify` 退出码 0、`report.json` 的 `ok=true`、`notes.md` 已补齐所有 `approximated` 差异。
4. 不要为了通过而改 `status.json`——先修 `src`，或如实保留 `unresolved` 并说明。
5. **收尾交叉验证**：即使 `verify` 已绿，也要按 1.5 走一遍——release 说明逐条确认、本轮接触的安全/白名单表全表对拍；差异分类后写进 `notes.md` 的 R 条目（无论移植与否）。
