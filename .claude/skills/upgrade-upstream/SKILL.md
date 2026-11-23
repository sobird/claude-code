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

- 目标版本 bundle（如 `package/cli.js`）、上一版本 bundle（对照基线）、可选 source map。目标版本 ≥ 2.1.113 时没有 JS bundle，先按 0.5 从原生二进制 carve。
- 目标版本官方 release 说明：`https://github.com/anthropics/claude-code/releases/tag/v<版本>`，流水线跑完后逐条对拍（见 1.5）。
- 新建 `docs/upgrade/<新版本>/`，所有产物放这里（参考 `docs/upgrade/2.1.89/`）。
- 先读上一版本的 `status.json` 和 `notes.md`：沿用台账格式、id 前缀和 R# 编号习惯。
- 开工先跑 `git status`：gates 的 current 侧是整个工作区（含未提交改动），并行会话的提交/改动会混进门禁结果。
- 开工前先和用户确认范围：哪些能力要移植，哪些允许 `ignored-dependency`。
- 探查场景参考 `scripts/upgrade/scenarios/`。最小形态是 `{"args":["--version"],"breakpoints":[],"capture":[]}`；断点需要 `script`（bundle 的 basename）、`line`、`column`、`label`，`capture` 可取 `args` / `return` / `fn.toString`。

## 0.5 原生发布（2.1.113+）：先 carve

从 2.1.113 起 npm 包是安装桩，产物是平台原生二进制（Bun 单文件可执行，如 `@anthropic-ai/claude-code-darwin-x64` 包里的 `claude`）；GitHub release 也只发原生 tar 包，没有 JS bundle。

```bash
bun scripts/upgrade/cli.ts carve --binary <native/claude> --out <work/claude-<版本>.carved.js>
```

- 原理：每个内嵌模块源码前都有 `// @bun @bytecode`（少数 `@bun-cjs`）标记行 + release banner + `// Version: X`；carve 校验标记行与 banner 后按图顺序拼接。banner 是去伪关键——裸标记字符串也出现在 Bun 字符串表里，不跟 banner 的都不算。
- 自检：产物应能用 `align` 跑通（TypeScript 解析器宽容），chunk 数和字节数在不同执行间一致；输出带 `binarySha256` 便于记录版本证据。
- 限制：拼接后的 bundle 没有原始属性顺序，`inventory` 的 commands/strings 会漏报或误报（env / flag 仍可靠）；`verify` 的账本语义要求目标版新增的 `cmd:` / `env:` 必须 `ported` / `approximated`，env 没有「不移植」状态，所以跨大版本的账本无法闭合——要么真移植，要么先和用户确认调整验收口径，不要硬凑状态。

## 1. 五步流水线

| 步骤                                                       | 产物               | 用途                                                                          |
| ---------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `inventory --bundle --out`                                 | `inventory.json`   | 版本号、命令、`CLAUDE_CODE_*`、CLI flag、字符串                               |
| `align --reference --target [--map] [--prior-align] --out` | `align.json`       | AST 函数级对齐；有 map 才有 high 置信度，无 map 用 `--prior-align` 继承旧归属 |
| `extract --align --target [--keywords] --out`              | `candidates/`      | 切出待移植片段，人工阅读                                                      |
| `probe --target --scenario --out`                          | `trace.json`       | 用 `scenarios/*.json` 断点采集运行时证据                                      |
| `verify --target --reference --src --status --out`         | `report.{md,json}` | 对拍 bundle 与 `src/`，校验台账闭合                                           |

辅助子命令（§1.5 交叉验证与收尾用）：

| 子命令                                                                                                  | 用途                                                                              |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `releasenotes --version --out [--repo]`                                                                 | 用 `gh release view` 拉官方说明并解析顶层条目；默认仓库 `anthropics/claude-code`  |
| `table --bundle --anchor [--whole] [--baseline <json> \| --src <path>#<export>] --out [--fail-on-diff]` | 从 bundle 锚点抽字面量表（`--whole` 取包含锚点的整张表），与参考版或 src 导出对拍 |
| `strings --target-inventory --reference-inventory --src [--release-notes] --out`                        | 新增字符串分诊：inSrc / releaseNotes / noise / unclassified                       |
| `diffbundle --reference --target --out (--segment --start --end \| --around --pad \| --anchors --band)` | 纯逻辑（无新字面量）改动定位：标识符归一化的 token 差分 / 唯一字面量锚点 delta    |
| `refresh-evidence --target --status [--in-place] [--fail-on-skipped]`                                   | 校验台账里的 `bundle:` 偏移，失效的按字符串重定位                                 |
| `gates --ref <git-ref> --out <dir> [--gate typecheck,lint,test] [--fail-on-new]`                        | 在 `--ref` 的临时 worktree 跑 typecheck/lint/test，与工作区做归一化多集差分       |

`align.json` 的节点有 `classification`（`matched` / `changed` / `new`，另有 `ignored-dependency` / `unattributed`）和 `confidence`；移植对象主要从 `changed` 和 `new` 里挑。`changed` 配对现在按字符串字面量重叠（Jaccard）+ 相对位置打分，选最像的候选，不再是同 kind 的第一个。

`verify` 退出码 0 才代表完成。`ok=false` 时逐项处理 `missingInSrc` / `unexpectedInSrc` / `unregistered` / `unresolved`。

## 1.5 交叉验证（release 说明 + 结构化常量表）

`inventory` / `align` / `extract` 只覆盖命令、env、flag 与字符串的增删。四处盲区必须补，`verify` 绿了也不代表没有漏项。

### 官方 release 说明

```bash
bun scripts/upgrade/cli.ts releasenotes --version v<目标版本> --out <work/release-notes-<版本>.json>
```

`releasenotes` 默认从 `anthropics/claude-code` 拉（fork 仓库没有上游 release，必须用 `--repo` 默认值或显式传）；输出 `{version, items}`，条目 1-based 编号对应台账的 `releaseItems`，`verify --release-notes` 也消费这份 JSON。拉不到时从 `https://github.com/anthropics/claude-code/releases/tag/v<版本>` 手工取正文，再用 `--body-file` 解析。逐条当作待移植候选：

- 每条都回目标 bundle 定位实现（`bundle:<偏移>` 写进 evidence），并和参考版逐行对照语义，不要只命中字符串。
- 说明里的「行为类」条目（过滤条件、重试、退出码、表格数据）通常不在 inventory 里，是漏项高发区。
- 无法移植的条目（UI/性能优化、打包依赖内部、本仓库没有的功能前提）在 `notes.md` 写明原因，不伪造实现。
- inventory 是双向漏报：CLI flag 可能漏收（本轮 `--remote-control-session-name-prefix` 走帮助/解析路径未被收录），要对着 release 说明和 bundle 里的 `--xxx` 字面量自查后手动登记；反过来，inventory 判定的目标新增 `cmd:` / `env:`（如隐藏的 `stop-hook`）也可能不在 release 说明里，台账仍要求闭合。

### 结构化常量表

对象字面量里的表项改动（如 PowerShell 只读允许表的 `safeFlags` / 回调）和常量数组追加（如公共参数集）不会进 inventory——值本身不是新增字符串，`verify` 也看不到。用 `table` 两步对拍：

```bash
# 参考版 vs 目标版：先 dump 参考版，再以 --baseline 对拍目标版
bun scripts/upgrade/cli.ts table --bundle <ref/cli.js> --anchor get-date --whole --out <work/table-ref.json>
bun scripts/upgrade/cli.ts table --bundle <target/cli.js> --baseline <work/table-ref.json> \
  --anchor get-date --whole --out <work/table-2.1.91.json>

# 目标版 vs src：导入对应导出，逐项对拍 keys / flags / 回调存在性
bun scripts/upgrade/cli.ts table --bundle <target/cli.js> --anchor get-date --whole \
  --src src/tools/PowerShellTool/readOnlyValidation.ts#CMDLET_ALLOWLIST --out <work/table-src.json>
```

`--anchor` 是**属性名**（如允许表里的 `get-date`，不带引号和值），不是用来定位的字符串片段；`--whole` 取包含该属性的整张表，默认只取该键的值。diff 为空时三个数组全空，非空时按 added / removed / changed 列出路径。函数/标识符按 `{ $ident: true }` 记录存在性，因此压缩后改名不会误报；`--src` 接受 `<path>#<export>`（`#` 后可带点路径）。

定位与判定：

- minified 变量名每版都变（如 `FYK`→`B$K`、`nX`→`YP`），用锚点字面量（如 `"get-date":{safeFlags`）或访问函数（如 `$az`→`B$K`）反查，别按变量名找。
- 缺失 = 漏移植；多出 = 有意保留或上游未同步（写进 notes）。
- 疑似改名先比函数体/返回值：逐字符相同即纯改名，不登记为行为变更。

### 字符串分诊

`inventory` 的字符串差集常把压缩器噪声、打包依赖文案和真正待移植项混在一起。收尾用 `strings` 分诊（输入是两份 `inventory.json`，`--release-notes` 传 `releasenotes` 产出的 JSON 或其正文）：

```bash
bun scripts/upgrade/cli.ts strings \
  --target-inventory <work/inventory-<目标版本>.json> \
  --reference-inventory <work/inventory-<参考版本>.json> --src src \
  --release-notes <work/release-notes-<版本>.json> --out <work/strings-<版本>>
```

四类桶：`inSrc`（源码已有，可能是改名/移动）、`releaseNotes`（命中 release 说明）、`noise`（依赖/压缩产物）、`unclassified`（需人工判断）。`unclassified` 逐条回 bundle 看上下文；上游 UI 文案、打包依赖内部等写进 `notes.md` 即可，不伪造移植。扫描器是字符级 JS 字面量扫描（处理引号/转义/模板插值/正则启发式），压缩 bundle 安全；长字符串偶尔会因正则识别误吞，用 `unclassified` 桶兜底。

### 纯逻辑（无新字面量）改动的定位

有些 release 条目（如「修复长会话回滚缓冲重复 diff / 空白页」）只改控制流，不加字符串、不改表项，`inventory` / `table` / `strings` 全都看不到。这时用 `diffbundle` 在 minified bundle 上做**标识符归一化的 token 差分**：把每个非关键字标识符归一成 `I`，压缩改名带来的差异就消失，只剩真正的逻辑增删。

```bash
# segment：两版都有的稳定字面量之间做 token 差分（最可信）
bun scripts/upgrade/cli.ts diffbundle --reference <ref/cli.js> --target <target/cli.js> \
  --segment --start '<起始字面量>' --end '<结束字面量>' --out <work/diff.json>
# around：一个锚点前后 ±pad 窗口（快，但两版窗口可能错位，定位不如 segment 稳）
bun scripts/upgrade/cli.ts diffbundle --reference <ref/cli.js> --target <target/cli.js> \
  --around '<锚点>' --pad 4000 --out <work/diff.json>
# anchors：O(n) 唯一字面量 delta 图，几 MB 区间也安全（不跑 Myers）
bun scripts/upgrade/cli.ts diffbundle --reference <ref/cli.js> --target <target/cli.js> \
  --anchors --out <work/anchors.json>
```

- 优先 `segment`：用两个稳定唯一字面量夹住可疑函数，例如 `render()` 从 `"Full reset (shrink->below)"` 到 `"Slow render:"`。`stats.identical` 为真即逐 token 等价（只剩改名），`runs[].text` 是 bundle 原文，可直接对读。
- Myers 有 `--max-edits` 预算：区间内有大段整体不同时返回 `truncated`，换更窄的 `segment`；或先 `--anchors` 用 `bigInsertions[].extra` 定位巨大插入点，再对那一小段做 segment，别让 O(N\*M) 卡死。
- **判定「修复其实在打包依赖里」**：待移植文件的核心函数 `segment` 出来 `identical`、而整段渲染带仍有差异时，多半差异落在打包依赖内部（wrap-ansi、ansi-tokenize、React reconciler、AWS smithy 等）。先拿该文件**独有的一个字符串字面量**作锚点，确认渲染带里哪个区间属于这个文件，再逐段查差异来源；只有依赖内部的差异就如实记 `approximated`（+ `ignored-dependency` 性质），不要硬凑移植。

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
- `env:` 没有「不移植」状态：上一版以 `approximated` 登记的依赖/扫描噪声 env（如 `CLAUDE_CODE_HOST_HTTP_PROXY_PORT` 一族）每个版本都要延续登记，并用 `refresh-evidence` 刷新偏移，否则会以 `unregistered` 重新出现。
- 目标新增的 `cmd:` 在 `src` 只有占位（如 `name:'stub'`）时，按上游命令对象补全 name/type/aliases/门控/load，接线到既有机制，不要新写业务逻辑（teleport 案例）。
- 任意登记条目为 `unresolved`，直接进报告的 `unresolved` 并让 `ok=false`。

证据格式（`evidence` 数组）：

- `bundle:<字符串>`、`bundle:<解码后字符偏移>`（如 `bundle:9937634`；用 `fs.readFileSync(path,'utf8')` + `indexOf` 得到，不是字节偏移）
- 偏移校验：`bundle:<偏移>` 处必须落在字面量内或标识符起始；`env:` 条目的偏移必须正好是变量名首字符（否则 `evidenceErrors`）。
- 行为类证据（`bundle:<偏移>`）必须指向**实际修复点**，不能只命中一个相关关键词。`bundle:scrollback` 可能只是 `csi.ts` 的 ED 擦除模式枚举，与「回滚重复 diff」无关；只命中关键词、而 `diffbundle --segment` 证明该处逐 token 等价时，应如实记 `approximated`（并写明原因），别让关键词制造「已定位」的假象。
- 缺失证明：`bundle:absent:<值>`、`bundle:no-name:"<值>"`
- `scenario:<scenario 文件名>`；有测试钉住行为时加 `test:<测试路径>`

id 前缀：`cmd:` / `env:` / `flag:` / `str:`；非 inventory 类问题用 `bundle-only:<主题>` 并写清说明。
`notes.md` 每条近似实现一段；验收阶段的额外妥协用 `R<编号>` 追加记录，沿用已有编号，不要重排。

## 3. 常见坑

- slash 命令不出现在 `--help`，用 `--version` 场景 probe 会得到空 trace，这是正常现象。验收改为：`scripts/config.ts` 的 `features` 含对应 flag + 构建后 external `dist/cli.js` 含命令描述字符串。
- 不稳定的运行时功能（GrowthBook、MCP 服务器、OAuth、claude.ai 端点）probe 无法驱动，改用静态偏移作证据，并在 `notes.md` 记 R 条目。
- `verify` 只读 `src/` 下的 `.ts`/`.tsx`（`readSources`）。把证据写进文档或 JSON 不会让检查通过，该在代码里出现的东西必须真的在代码里。
- feature flag 必须字面量写成 `feature('NAME')` 且直接位于 if/三元条件中，否则 tree-shaking 失效。
- 相对导入用 `.js` 后缀；格式由 oxfmt 决定，生成的 `report.md`、`status.json`、`report.json` 也要过 `fmt:check`。`refresh-evidence` / `verify` 重写这些 JSON 时会把数组压成单行，收尾用 `bunx oxfmt <改动的 json/md>` 定点格式化再 `--check`（别跑全仓 `bun run fmt`，会顺带改到并行会话的未提交文件）。
- 移植上游压缩产物后 lint 高发：`[...].sort()`→`toSorted()`、`.reverse()`→`toReversed()`、去掉无谓展开、删除拆分残留的未用变量（本轮 6 条 lint 全属此类）。
- 无 source map 时对齐置信度只有 medium/low；跨版本用 `--prior-align` 继承上一轮对齐结果。
- `verify` 默认 `--reference cli.js`，别忘了显式传上一版本 bundle；`--out` 传的是**版本目录**本身（如 `docs/upgrade/2.1.94`），不是 `.../report`，否则会在 `report/` 下再套一层。
- probe 会真实启动 bundle（node inspector + `ws`），场景里的断点行号是 bundle 里的位置，不是源码行号。
- 一处表项变更常带同族联动：安全动作参数白名单同时改了公共参数集（4 个短别名并入 `x$K`）。只按 release 说明标题移植会窄一圈——移植时抽上游整段 diff，别只抽标题命中的字符串。
- 仓库有跨表不变量：`CMDLET_ALLOWLIST` 里每个带 `additionalCommandIsDangerousCallback` 的条目，必须在 `src/utils/powershell/dangerousCmdlets.ts` 的 `ARG_GATED_CMDLETS`（进而 `NEVER_SUGGEST`）里，否则权限对话框会建议 `cmd:*` 通配、永久绕过回调。新增回调必须同步并跑一致性断言。
- `verify` 只证明台账闭合，不证明行为等价；安全相关改动按 TDD 先写失败测试。

## 4. 门禁

1. **开工前**：范围与预计状态清单经用户确认；拿不准的条目记 `unresolved`，不要猜状态让它变绿。
2. **每批改动后**：对改动文件运行 `verify` skill 的四项检查（typecheck / fmt:check / lint / test）。
3. **收尾**：`verify` 退出码 0、`report.json` 的 `ok=true`、`notes.md` 已补齐所有 `approximated` 差异；`refresh-evidence` 确认 `bundle:` 偏移仍有效（`skipped` 为 0 或已说明）。
4. 不要为了通过而改 `status.json`——先修 `src`，或如实保留 `unresolved` 并说明。
5. **收尾交叉验证**：即使 `verify` 已绿，也要按 1.5 走一遍——release 说明逐条确认（`releasenotes` + `releaseItems` 覆盖率）、本轮接触的安全/白名单表全表对拍（`table --whole`）、新增字符串分诊（`strings`）；差异分类后写进 `notes.md` 的 R 条目（无论移植与否）。
6. **基线门禁**：`gates --ref <上一版本或 HEAD> --fail-on-new` 只报本轮新增的 typecheck/lint/test 发现；仓库自带存量报错，不要用绝对退出码判断。非 0 时读 `gates.md` 的 Added 段，确认是本次改动引入还是基线已有。
   - test 门禁跑的是 `bun test`（递归全仓，**含 `packages/rcs`**），不是 `bun run test`（排除 rcs）。rcs 用例依赖共享 PGlite/端口，在 gate 的临时 worktree 里环境不同、并行负载下易 flake，整段 rcs 失败会以 added 出现而基线为 0——这不是本升级引入的。
   - 只改 `src/` 时用 `--gate typecheck,lint`；若坚持跑 test，确认 added 全是 `packages/rcs` 后单跑 `bun test packages/rcs` 佐证，并在 `notes.md` 记 R 条目。
   - current 侧是**整个工作区**（含未提交的并行改动），跑前先 `git status`。
7. **并行会话卫生**：本工作区可能与另一个会话并行改动（如 `packages/rcs`）。提交 / 格式化 / 门禁都只圈定本轮路径：按文件名 `git add <具体文件>`，绝不 `git add -A` / `git add .`；用 `bunx oxfmt <改动文件>` 定点格式化，不跑全仓 `fmt`；确认 `packages/rcs` 的未提交改动属于并行会话就原样留着，不纳入本轮提交。
