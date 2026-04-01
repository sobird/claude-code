# @sobird/murph

[![npm][npm]][npm-url]
![TypeScript][typescript]
![Node.js][node]
![CLI][cli]
[![Build Status][build-status]][build-status-url]
[![License][license]][license-url]
[![Install Size][size]][size-url]

> A pristine TypeScript template for rapid project inception.

## 🛠️ Step into the Singularity

Don't just clone. **Incept.** The fastest way to bootstrap your next pristine project is via `degit`, ensuring zero git history contamination.

```bash
# Incept a new project in the current directory
npx degit sobird/murph .

# Or, incept in a specific folder
npx degit sobird/murph my-new-dimension

# reset name & version
cd my-new-dimension
rm CHANGELOG.md

# Initialize the equation
pnpm install
```

### 🛰️ Engineering & Governance

`murph` adheres to the highest standards of automated software delivery. Every change is tracked, and every release is predictable.

- **[Conventional Commits](https://www.conventionalcommits.org/)**: Every commit follows a strict semantic structure to ensure clarity and machine-readability.
- **[Release Please](https://github.com/googleapis/release-please)**: Automated versioning and changelog generation. No manual `npm version` required.
- **[Provenance](https://docs.npmjs.com/generating-provenance-statements)**: Every NPM release includes a build provenance statement, linking the package directly to its GitHub source.

### 🤖 CI/CD Pipeline

The singularity is maintained through an automated lifecycle:
1. **Commit**: Developers push `feat:`, `fix:`, or `docs:` commits.
2. **Review**: A release PR is automatically maintained by `release-please`.
3. **Ascension**: Upon merging the release PR, the package is built, tested, and published to NPM with an OIDC-authenticated handshake.

## License

[MIT](./LICENSE) License &copy; 2024 [sobird](https://github.com/sobird)

<!-- Badges -->
[npm]: https://img.shields.io/npm/v/@sobird/murph.svg?style=flat-square&logo=npm&label=@sobird/murph
[npm-url]: https://www.npmjs.com/package/@sobird/murph
[build-status]: https://img.shields.io/github/actions/workflow/status/sobird/murph/release.yml?label=CI&logo=github&style=flat-square
[build-status-url]: https://github.com/sobird/murph/actions
[size]: https://img.shields.io/badge/dynamic/json?style=flat-square&label=mass&query=$.publish.pretty&url=https://packagephobia.com/v2/api.json?p=@sobird/murph&color=blueviolet
[size-url]: https://packagephobia.com/result?p=@sobird/murph
[license]: https://img.shields.io/github/license/sobird/murph.svg?style=flat-square&v=1
[license-url]: https://github.com/sobird/murph/blob/master/LICENSE
[typescript]: https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white
[cli]: https://img.shields.io/badge/-CLI-000000?style=flat-square&logo=gnu-bash
[node]: https://img.shields.io/badge/-Node.js-339933?style=flat-square&logo=node.js&logoColor=white
