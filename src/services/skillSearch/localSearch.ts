/**
 * Keyword index over the locally available skills.
 *
 * The upstream implementation is not recoverable, but every consumer in this
 * tree only needs (a) `clearSkillIndexCache` for invalidation and (b) a way
 * to rank skills against a short query. The index is built on top of
 * `getSkillToolCommands` (lazily required — commands.ts requires this module
 * for cache invalidation, so a static import would be circular) plus any
 * extra MCP skills the caller threads in.
 *
 * Matching is deliberately lexical: name tokens score higher than description
 * tokens, and only positive- scoring results are returned. The TTL keeps
 * repeated discovery passes within one turn cheap while still picking up
 * skills loaded mid-session.
 */

import type { Command } from '../../types/command.js'

const INDEX_TTL_MS = 60_000
const MAX_RESULTS = 5
const MIN_TOKEN_LENGTH = 3
const NAME_WEIGHT = 3
const BODY_WEIGHT = 1

type IndexEntry = {
  name: string
  nameTokens: Set<string>
  bodyTokens: Set<string>
  command: Command
}

export type SkillIndex = {
  builtAt: number
  entries: IndexEntry[]
}

let cachedIndex: SkillIndex | null = null

export function clearSkillIndexCache(): void {
  cachedIndex = null
}

function tokenize(text: string): string[] {
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return spaced.split(/[^a-z0-9]+/).filter((token) => token.length >= MIN_TOKEN_LENGTH)
}

function buildIndex(commands: readonly Command[]): IndexEntry[] {
  const byName = new Map<string, IndexEntry>()
  for (const command of commands) {
    if (byName.has(command.name)) continue
    const body = [command.description, command.whenToUse ?? '', command.argumentHint ?? ''].join(' ')
    byName.set(command.name, {
      name: command.name,
      nameTokens: new Set(tokenize(command.name)),
      bodyTokens: new Set(tokenize(body)),
      command,
    })
  }
  return [...byName.values()]
}

/**
 * Returns the current index, rebuilding it when it is older than the TTL.
 * `extraCommands` (MCP skills, which live outside getSkillToolCommands) are
 * folded into the build; the first caller of a TTL window determines them.
 */
export async function getSkillIndex(extraCommands: readonly Command[] = []): Promise<SkillIndex> {
  if (cachedIndex !== null && Date.now() - cachedIndex.builtAt < INDEX_TTL_MS) {
    return cachedIndex
  }
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { getSkillToolCommands } = require('../../commands.js') as typeof import('../../commands.js')
  const { getProjectRoot } = require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  const commands = await getSkillToolCommands(getProjectRoot())
  cachedIndex = {
    builtAt: Date.now(),
    entries: buildIndex([...commands, ...extraCommands]),
  }
  return cachedIndex
}

/**
 * Rank skills against `query`. Returns at most `limit` commands with a
 * positive score, best first; otherwise an empty array.
 */
export async function searchSkills(
  query: string,
  extraCommands: readonly Command[] = [],
  limit: number = MAX_RESULTS,
): Promise<Command[]> {
  const queryTokens = [...new Set(tokenize(query))]
  if (queryTokens.length === 0) {
    return []
  }

  const index = await getSkillIndex(extraCommands)
  const scored: { command: Command; score: number }[] = []
  for (const entry of index.entries) {
    let score = 0
    for (const token of queryTokens) {
      if (entry.nameTokens.has(token)) score += NAME_WEIGHT
      else if (entry.bodyTokens.has(token)) score += BODY_WEIGHT
    }
    if (score > 0) {
      scored.push({ command: entry.command, score })
    }
  }

  scored.sort((a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name))
  return scored.slice(0, limit).map((item) => item.command)
}
