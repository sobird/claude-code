import { writeFile } from 'node:fs/promises'
import pkg from '../package.json'
import { external } from './config'

// await rename('dist/cli.js', 'cli.js');
// pkg.bin.sobird = 'cli.js';

// @ts-expect-error: reset
const dependencies = Object.fromEntries(external.map((dep) => [dep, pkg.dependencies[dep]]))
// @ts-expect-error: reset
pkg.dependencies = dependencies
// @ts-expect-error: reset
pkg.devDependencies = undefined
// @ts-expect-error: reset
pkg.workspaces = undefined
// @ts-expect-error: reset
pkg.publishConfig = undefined
// @ts-expect-error: reset
pkg.scripts = {}
// @ts-expect-error: reset
pkg['lint-staged'] = undefined

await writeFile('package.json', JSON.stringify(pkg, null, 2))
