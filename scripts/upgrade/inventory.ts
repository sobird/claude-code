import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { extractStringLiterals } from './stringScanner'
import type { CommandEntry, Inventory } from './types'

// The closing-quote lookahead rejects dynamically composed names such as
// `name:"mcp__"+...`, which are not commands and have no static name to check.
const COMMAND_RE = /type:\s*["'](local|local-jsx|prompt)["']\s*,\s*name:\s*["']([^"']+)["'](?=\s*[,}])/g
const ENV_RE = /CLAUDE_CODE_[A-Z0-9_]+/g
const FLAG_RE = /\.option\(\s*["'](--[a-z0-9-]+)["']/g
const VERSION_RE = /["'](2\.\d+\.\d+)["']/

const EXTRA_ENV = ['MCP_CONNECTION_NONBLOCKING']

const uniqSorted = (values: Iterable<string>): string[] => [...new Set(values)].toSorted()

export async function scanBundle(filePath: string): Promise<Inventory> {
  const bytes = await readFile(filePath)
  const source = bytes.toString('utf8')

  const commands = new Map<string, CommandEntry>()
  for (const match of source.matchAll(COMMAND_RE)) {
    const type = match[1] as CommandEntry['type']
    const name = match[2]
    commands.set(`${type}:${name}`, { type, name })
  }

  const extras = EXTRA_ENV.filter((name) => source.includes(name))
  const envVars = uniqSorted([...source.matchAll(ENV_RE)].map((match) => match[0]).concat(extras))
  const cliFlags = uniqSorted([...source.matchAll(FLAG_RE)].map((match) => match[1]))

  return {
    version: VERSION_RE.exec(source)?.[1] ?? null,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    commands: [...commands.values()].toSorted((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type)),
    envVars,
    cliFlags,
    strings: uniqSorted(extractStringLiterals(source)),
  }
}
