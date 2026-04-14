# @sobird/claude-code

[![npm][npm]][npm-url]
[![bun][bun]][bun-url]
![TypeScript][typescript]
![Node.js][node]
![CLI][cli]
[![Build Status][build-status]][build-status-url]
[![License][license]][license-url]
[![Install Size][size]][size-url]

## 开发调试

打开`vscode`运行和调试面板，选择`⚡️ Attach to claude code`，点击`开始调试（F5）`。

编译后调试（代码未压缩）

按下 `command + shift + p`，输入 `Debug: JavaScript Debug Terminal`，回车。
在`JavaScript Debug Terminal`终端面板下输入：

```bash
node dist/cli.js
```

即可进入代码调试

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
