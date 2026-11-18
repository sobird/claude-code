---
name: upgrade-upstream
description: Port a new upstream Claude Code release into this repo's hand-written src/ using the scripts/upgrade pipeline (inventory → align → extract → probe → verify). Use when asked to upgrade/同步上游版本, or when working inside docs/upgrade/<version>/.
---

# 上游版本升级

本仓库的 `src/` 是手写源码，官方发布物是压缩后的 `cli.js`。升级分两段：

- **A. 建立基线与证据**：`inventory → align → extract → probe`
- **B. 移植并闭合台账**：改 `src/` → 登记 `status.json` → `verify` 退出码 0

命令和 flag 的权威来源是 `bun scripts/upgrade/cli.ts --help` 与根 `README.md` 的「如何用流水线升级版本」一节。本 skill 只写顺序、约定和坑，不要在这里复制 flag 列表。

## 0. 准备

- 目标版本 bundle（如 `package/cli.js`）、上一版本 bundle（对照基线）、可选 source map。
- 新建 `docs/upgrade/<新版本>/`，所有产物放这里（参考 `docs/upgrade/2.1.89/`）。
- 先读上一版本的 `status.json` 和 `notes.md`：沿用台账格式、id 前缀和 R# 编号习惯。
- 开工前先和用户确认范围：哪些能力要移植，哪些允许 `ignored-dependency`。

## 1. 五步流水线

| 步骤                                                       | 产物               | 用途                                                                          |
| ---------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `inventory --bundle --out`                                 | `inventory.json`   | 版本号、命令、`CLAUDE_CODE_*`、CLI flag、字符串                               |
| `align --reference --target [--map] [--prior-align] --out` | `align.json`       | AST 函数级对齐；有 map 才有 high 置信度，无 map 用 `--prior-align` 继承旧归属 |
| `extract --align --target [--keywords] --out`              | `candidates/`      | 切出待移植片段，人工阅读                                                      |
| `probe --target --scenario --out`                          | `trace.json`       | 用 `scenarios/*.json` 断点采集运行时证据                                      |
| `verify --target --reference --src --status --out`         | `report.{md,json}` | 对拍 bundle 与 `src/`，校验台账闭合                                           |

`verify` 退出码 0 才代表完成。`ok=false` 时逐项处理 `missingInSrc` / `unexpectedInSrc` / `unregistered` / `unresolved`。

## 2. 台账约定

权威实现：`scripts/upgrade/verify.ts` 与 `scripts/upgrade/types.ts`。

状态语义：

- `already-present`：目标版本新增的面，`src` 里本来就有，无需改动。
- `ported`：本次完成移植。
- `approximated`：已移植但行为近似，必须在 `notes.md` 写明差异和原因。
- `ignored-dependency`：差异来自打包依赖（如 sandbox-runtime），只作提示，不参与失败判定。
- `retained-internal`：上游没有或已删除，但本仓库有意保留。
- `unresolved`：未解决。**verify 必然失败，不能当完成态**。

判定规则（来自 `verify.ts`）：

- 目标版新增的 `cmd:` / `env:` 若不在 `src`，必须在台账登记且状态为 `ported`/`approximated`，否则进 `missingInSrc`。
- 参考版有、目标版没有、但 `src` 仍存在的 `cmd:` / `env:`，必须登记为 `already-present`/`retained-internal`，否则进 `unexpectedInSrc`。
- `flag:` / `str:` 条目按「属于哪个 bundle」分类，不看 `src`；`ignored-dependency` 直接跳过。
- 任何有差异但没登记台账的 id 进 `unregistered`。

证据格式（`evidence` 数组）：

- `bundle:<字符串>`、`bundle:<字节偏移>`（如 `bundle:9937634`）
- 缺失证明：`bundle:absent:<值>`、`bundle:no-name:"<值>"`
- `scenario:<scenario 文件名>`；有测试钉住行为时加 `test:<测试路径>`

id 前缀：`cmd:` / `env:` / `flag:` / `str:`；非 inventory 类问题用 `bundle-only:<主题>` 并写清说明。
`notes.md` 每条近似实现一段，验收妥协用 `R<编号>` 记录（沿用已有编号，不要重排）。

## 3. 已知坑

- slash 命令不出现在 `--help`，用 `--version` 场景 probe 会得到空 trace，这是正常现象。验收改为：`scripts/config.ts` 的 `features` 含对应 flag + 构建后 external `dist/cli.js` 含命令描述字符串。
- 不稳定的运行时功能（GrowthBook、MCP 服务器、OAuth、claude.ai 端点）probe 无法驱动，改用静态偏移作证据，并在 `notes.md` 记 R 条目。
- feature flag 必须字面量写成 `feature('NAME')` 且直接位于 if/三元条件中，否则 tree-shaking 失效。
- 相对导入用 `.js` 后缀；格式由 oxfmt 决定，生成的 `report.md` 也要过 `fmt:check`。
- 无 source map 时对齐置信度只有 medium/low；跨版本用 `--prior-align` 继承上一轮对齐结果。
- `verify` 默认 `--reference cli.js`，别忘了显式传上一版本 bundle。

## 4. 门禁

1. **开工前**：范围与预计状态清单经用户确认；拿不准的条目记 `unresolved`，不要猜状态让它变绿。
2. **每批改动后**：对改动文件运行 `verify` skill 的四项检查（typecheck / fmt:check / lint / test）。
3. **收尾**：`verify` 退出码 0、`report.json` 的 `ok=true`、`notes.md` 已补齐所有 `approximated` 差异。
4. 不要为了通过而改 `status.json`——先修 `src`，或如实保留 `unresolved` 并说明。
