# @sobird/claude-code

[![npm][npm]][npm-url]
[![bun][bun]][bun-url]
![TypeScript][typescript]
![Node.js][node]
![CLI][cli]
[![Build Status][build-status]][build-status-url]
[![Install Size][size]][size-url]

> 源于一个 59.8 MB 的 JavaScript 源映射文件（Source Map）`cli.js.map`

## 📦 安装

```bash
npm install -g @sobird/claude-code
```

进入到你的项目目录并运行 `sobird`

## 🛠️ 开发设置

### 前提条件

- [x] Node.js 18+ 请自行安装
- [x] Bun 全局安装 `npm i -g bun`

### 克隆和安装

```bash
# 克隆仓库
git clone https://github.com/sobird/claude-code.git

# 进入仓库目录
cd claude-code

# 安装依赖
bun install
```

### 在开发模式下运行

```bash
# 在终端运行（基于当前项目） claude code
bun run dev
```

### 构建项目

```bash
# 生产环境构建
bun run build

# 在本项目目录运行构建后的版本
node dist/cli.js

# 或者 链接到本机全局命令 sobird，使用sobird命令运行任意项目 （可选）
npm link
```

### 如何用流水线升级版本

升级到新的上游版本时，按 `carve → inventory → align → extract → probe → verify` 的顺序运行 `scripts/upgrade/cli.ts` 的子命令，前一步的产物作为后一步的输入：

```bash
# 0. （仅 2.1.113+ 原生发布）从 Bun 单文件可执行中抽出内嵌 JS 模块图
bun scripts/upgrade/cli.ts carve --binary <native/claude> --out <carved.js>

# 1. 盘点 bundle：命令、环境变量、CLI 参数与字符串
bun scripts/upgrade/cli.ts inventory --bundle <upstream/cli.js> --out <inventory.json>

# 2. 对比参考版与目标版的函数节点，生成对齐结果
bun scripts/upgrade/cli.ts align --reference <2.1.88/cli.js> --target <2.1.89/cli.js> --out <align-dir>

# 3. 从变更节点中抽取待移植的字符串候选
bun scripts/upgrade/cli.ts extract --align <align-dir/align.json> --target <2.1.89/cli.js> --out <candidates-dir>

# 4. 用场景脚本探测运行时行为
bun scripts/upgrade/cli.ts probe --target <2.1.89/cli.js> --scenario <scenario.json> --out <trace.json>

# 5. 对拍源码与目标 bundle，校验台账并输出报告
bun scripts/upgrade/cli.ts verify --target <2.1.89/cli.js> --reference ./cli.js --src src --status docs/upgrade/2.1.89/status.json --out <report-dir>
```

自 2.1.113 起 npm 包不再发布 `cli.js`：包是一个安装桩，真正的产物是平台原生二进制（Bun 单文件可执行）。`carve` 把所有带 `// @bun @bytecode` + release banner 的内嵌模块源码按图顺序拼成伪 bundle，后续步骤都接受它作为 target；但它的命令/字符串盘点会受属性顺序影响，只能当近似基线。

其余五个步骤里，`inventory` 与 `align` 建立差异基线，`extract` 与 `probe` 收集待移植的静态字符串和运行时证据，`verify` 最终核对所有台账条目是否处于终态并生成 `report.md` / `report.json`。

## 🐛 调试

### 实时预览（改代码自动重画）

想「改一个组件立刻看到效果」，用这个 harness：它把目标界面渲染进终端，`bun --watch` 监视到文件改动就重启进程重画。

```bash
bun run dev:ui
```

编辑 `scripts/ui-harness.tsx` 里 `Demo()` 返回的组件即可切换预览对象，保存后自动重载，`Ctrl+C` 退出。真实界面一般需要 app 的 provider，harness 已按 `tests/testing/ink.tsx` 包好 `AppStateProvider` + `KeybindingSetup`（`render` 另加 `ThemeProvider`）。

说明：全屏 TUI 没法真正热替换（Ink 的 reconciler 持有终端状态，中途换树会错位），所以这里的「实时」是**整进程重启**；harness 在退出信号里先 `unmount()`，让 Ink 复原 raw mode / 光标，避免重启之间把终端弄乱。

### 开发模式调试

打开`vscode`运行和调试面板，选择`⚡️ Attach to claude code`，点击`开始调试（F5）`。

### 生产构建调试

按下 `command + shift + p`，输入 `Debug: JavaScript Debug Terminal`，回车。
在`JavaScript Debug Terminal`终端面板下输入：

```bash
node dist/cli.js
```

### 源码级断点

上面的 attach 对应到现成脚本，分别断在源码和构建产物：

```bash
bun run debug          # bun --inspect-brk，断在 src/**.ts(x)
bun run debug:dist     # node --inspect-brk dist/cli.js，配合 cli.js.map
```

运行后在 Chrome 的 `chrome://inspect` 或 VS Code 里 attach。

### 调试日志

以调试模式启动（等价于 `bun run dev` 加 `--debug`）：

```bash
bun run dev:log
```

日志写入 `~/.claude/debug/<sessionId>.txt`，并维护一个 `latest` 软链便于 tail：

```bash
tail -f ~/.claude/debug/latest
```

常见开关：

- `--debug=<filter>`：按模块包含/排除，例如 `--debug=ink,render`、`--debug=!1p,!file`
- `--debug-to-stderr`（`-d2e`）：日志同时打到 stderr
- `--debug-file <path>`：写到指定文件
- `CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose`：连带输出更啰嗦的诊断（默认 `debug`）

会话中途也可以运行 `/debug` 开启日志并回读。

### 终端录制（asciicast）

把整段 TUI 录成 asciicast v2，可用 `asciinema` 回放。录制器仅在 `USER_TYPE=ant` 且 `CLAUDE_CODE_TERMINAL_RECORDING=1` 时启用，脚本已替你设好这两个变量：

```bash
bun run dev:record
```

录制文件落在 `~/.claude/projects/<sanitized-cwd>/<sessionId>-<timestamp>.cast`：

```bash
asciinema play ~/.claude/projects/<...>/<sessionId>-*.cast
```

### React DevTools（查看 Ink 的 UI 组件树）

CLI 的界面由自定义的 Ink renderer 渲染，默认在 React DevTools 里是看不到的。用独立的 React DevTools 应用即可查看其组件树、props/hooks，并随交互实时刷新。

前置条件：

- 全局安装独立前端应用（自带 Electron，会打开一个窗口并监听 `8097` 端口）：
  ```bash
  npm i -g react-devtools
  ```
- 后端依赖 `react-devtools-core` 已在仓库的 `devDependencies` 中，无需额外安装。

使用步骤：

1. 终端 A 启动前端：`react-devtools`
2. 终端 B 以开发模式启动 CLI：`bun run dev`（Bun 默认 `NODE_ENV=development`，会自动加载 `src/ink/devtools.ts`）
3. 在 DevTools 窗口顶部把 renderer 切到 `ink`，即可看到组件树并实时刷新。

说明：

- 仅在开发模式生效：`src/ink/reconciler.ts` 在 `NODE_ENV === 'development'` 下动态引入 `src/ink/devtools.ts`，生产构建不会加载。
- `react-devtools-core` 的后端是按浏览器环境写的，该模块会把 `self`/`window` 别名到 `globalThis`（对整个进程生效），再依次调用 `initialize()`、`connectToDevTools()`。
- 若 `react-devtools` 报 `Electron failed to install correctly`，说明 Electron 二进制没下载成功；设置镜像 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 后重装，或删除 `node_modules/electron` 再重装。

## 免责声明

本仓库仅供个人学习、研究、交流和参考使用，请勿将其用于任何商业活动

<!-- Badges -->

[npm]: https://img.shields.io/npm/v/@sobird/claude-code.svg?style=flat-square&logo=npm&label=@sobird/claude-code
[npm-url]: https://www.npmjs.com/package/@sobird/claude-code
[bun]: https://img.shields.io/badge/bundler-Bun-black?style=flat-square&logo=bun
[bun-url]: https://bun.sh/
[build-status]: https://img.shields.io/github/actions/workflow/status/sobird/claude-code/release.yml?label=CI&logo=github&style=flat-square
[build-status-url]: https://github.com/sobird/claude-code/actions
[size]: https://img.shields.io/badge/dynamic/json?style=flat-square&label=mass&query=$.publish.pretty&url=https://packagephobia.com/v2/api.json?p=@sobird/claude-code&color=blueviolet
[size-url]: https://packagephobia.com/result?p=@sobird/claude-code
[license]: https://img.shields.io/github/license/sobird/claude-code.svg?style=flat-square&v=1
[license-url]: https://github.com/sobird/claude-code/blob/master/LICENSE
[typescript]: https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white
[cli]: https://img.shields.io/badge/-CLI-000000?style=flat-square&logo=gnu-bash
[node]: https://img.shields.io/badge/-Node.js-339933?style=flat-square&logo=node.js&logoColor=white
