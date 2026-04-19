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

## 🐛 调试

### 开发模式调试

打开`vscode`运行和调试面板，选择`⚡️ Attach to claude code`，点击`开始调试（F5）`。

### 生产构建调试

按下 `command + shift + p`，输入 `Debug: JavaScript Debug Terminal`，回车。
在`JavaScript Debug Terminal`终端面板下输入：

```bash
node dist/cli.js
```

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
