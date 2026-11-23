/**
 * Feature-change report for one upstream bump.
 *
 * `verify` answers "is the ledger closed?" and `strings` answers "what new
 * literals appeared?". Neither answers "what did upstream add or delete, and
 * what did we keep or drop along with it?". This command joins the two
 * inventories, the status ledger, and the official release notes into one
 * human-readable report; it is a reporting sibling of `strings` and never
 * gates the pipeline.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { releaseCoverage, type ReleaseNotes } from './releaseNotes'
import { renderTable } from './report'
import type { CommandEntry, Inventory, Status, StatusEntry, StatusLedger } from './types'

export type EntryRef = { id: string; status: Status; notes?: string }

export type ReleaseItemRow = { item: number; text: string; entries: EntryRef[] }

export type FeaturesReport = {
  source: { reference: string | null; target: string | null }
  counts: {
    added: number
    retained: number
    synced: number
    releaseItems: number
    uncovered: number
    unknown: number
  }
  added: { commands: CommandEntry[]; envVars: string[]; cliFlags: string[] }
  removed: { retained: EntryRef[]; synced: string[] }
  releaseItems: ReleaseItemRow[]
  /** Ledger entries without `releaseItems` that are not already in `removed.retained`. */
  unreferenced: EntryRef[]
  uncovered: number[]
  unknown: string[]
}

export type FeaturesInput = {
  reference: Inventory
  target: Inventory
  ledger: StatusLedger
  notes: ReleaseNotes
}

const STATUS_ORDER: Status[] = [
  'unresolved',
  'approximated',
  'ported',
  'already-present',
  'ignored-dependency',
  'retained-internal',
]

function commandNames(inventory: Inventory): Set<string> {
  return new Set(inventory.commands.map((command) => command.name))
}

function inventoryIds(inventory: Inventory): string[] {
  return [
    ...inventory.commands.map((command) => `cmd:${command.name}`),
    ...inventory.envVars.map((name) => `env:${name}`),
    ...inventory.cliFlags.map((name) => `flag:${name}`),
  ]
}

function entryRef(entry: StatusEntry): EntryRef {
  return entry.notes === undefined
    ? { id: entry.id, status: entry.status }
    : { id: entry.id, status: entry.status, notes: entry.notes }
}

export function buildFeaturesReport({ reference, target, ledger, notes }: FeaturesInput): FeaturesReport {
  const referenceCommandNames = commandNames(reference)
  const referenceEnv = new Set(reference.envVars)
  const referenceFlags = new Set(reference.cliFlags)

  const added = {
    commands: target.commands
      .filter((command) => !referenceCommandNames.has(command.name))
      .toSorted((a, b) => a.name.localeCompare(b.name)),
    envVars: target.envVars.filter((name) => !referenceEnv.has(name)).toSorted(),
    cliFlags: target.cliFlags.filter((name) => !referenceFlags.has(name)).toSorted(),
  }

  // Everything the reference bundle had that the target dropped. The ledger is
  // authoritative for "we kept it on purpose": retained-internal entries can
  // cover ids the prefix-based inventory scan misses (e.g. CLAUDE_REPL_MODE).
  const targetIds = new Set(inventoryIds(target))
  const removedIds = inventoryIds(reference)
    .filter((id) => !targetIds.has(id))
    .toSorted()
  const retainedById = new Map<string, EntryRef>()
  for (const entry of ledger.entries) {
    if (entry.status === 'retained-internal') retainedById.set(entry.id, entryRef(entry))
  }
  const retained = [...retainedById.values()].toSorted((a, b) => a.id.localeCompare(b.id))
  const retainedIds = new Set(retained.map((entry) => entry.id))
  const synced = removedIds.filter((id) => !retainedIds.has(id))

  const byItem = new Map<number, EntryRef[]>()
  for (const entry of ledger.entries) {
    for (const item of entry.releaseItems ?? []) {
      const refs = byItem.get(item)
      if (refs) refs.push(entryRef(entry))
      else byItem.set(item, [entryRef(entry)])
    }
  }
  const releaseItems = notes.items.map((text, index) => ({
    item: index + 1,
    text,
    entries: byItem.get(index + 1) ?? [],
  }))

  const unreferenced = ledger.entries
    .filter((entry) => (entry.releaseItems ?? []).length === 0 && entry.status !== 'retained-internal')
    .map(entryRef)
    .toSorted((a, b) => a.id.localeCompare(b.id))

  const coverage = releaseCoverage(ledger, notes.items.length)

  return {
    // The inventory's `version` is the bundle's internal version (2.0.0 for
    // both sides here); the ledger source carries the release labels.
    source: { reference: ledger.source.reference || reference.version, target: ledger.source.target || target.version },
    counts: {
      added: added.commands.length + added.envVars.length + added.cliFlags.length,
      retained: retained.length,
      synced: synced.length,
      releaseItems: notes.items.length,
      uncovered: coverage.uncovered.length,
      unknown: coverage.unknown.length,
    },
    added,
    removed: { retained, synced },
    releaseItems,
    unreferenced,
    uncovered: coverage.uncovered,
    unknown: coverage.unknown,
  }
}

function flatten(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncate(value: string, max: number): string {
  const flat = flatten(value)
  const clipped = flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
  // Table cells are inline markdown. Escape the cell separator and the one
  // underscore shape that starts emphasis (`ENABLE_/DISABLE`); intraword
  // underscores like `ENV_RE` are left alone because oxfmt unescapes them.
  return clipped
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replace(/([A-Za-z0-9])_(?=[^A-Za-z0-9])/g, '$1\\_')
}

function statusSummary(entries: EntryRef[]): string {
  if (entries.length === 0) return 'uncovered'
  const unique = [...new Set(entries.map((entry) => entry.status))]
  return unique.toSorted((a, b) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b)).join(', ')
}

function renderBullets(title: string, values: string[]): string[] {
  const lines = [`### ${title}`, '']
  if (values.length === 0) lines.push('_none_')
  else for (const value of values) lines.push(`- \`${value.replaceAll('`', '\\`')}\``)
  lines.push('')
  return lines
}

export function renderFeaturesMarkdown(report: FeaturesReport): string {
  const { reference, target } = report.source
  const lines: string[] = [
    `# 功能变更报告 ${reference ?? '?'} → ${target ?? '?'}`,
    '',
    '数据来源：`status.json`、两份 `inventory.json` 与官方 release notes；由 `bun scripts/upgrade/cli.ts features` 生成。',
    '',
    '## 概览',
    '',
    ...renderTable(
      ['项', '数量'],
      [
        ['新增（inventory）', String(report.counts.added)],
        ['官方删除但保留', String(report.counts.retained)],
        ['跟随官方删除', String(report.counts.synced)],
        ['release items', String(report.counts.releaseItems)],
        ['未覆盖', String(report.counts.uncovered)],
      ],
    ),
    '',
    '## 新增功能点（inventory）',
    '',
    ...renderBullets(
      '命令',
      report.added.commands.map((command) => `${command.name} (${command.type})`),
    ),
    ...renderBullets('环境变量', report.added.envVars),
    ...renderBullets('CLI 参数', report.added.cliFlags),
    '行为级新增见下方「全量 release items」中状态为 `ported` / `approximated` 的条目。',
    '',
    '## 删除的功能点',
    '',
    '### 官方删除但本仓库有意保留',
    '',
  ]

  if (report.removed.retained.length === 0) lines.push('_none_')
  else
    lines.push(
      ...renderTable(
        ['条目', '状态', '说明'],
        report.removed.retained.map((entry) => [entry.id, entry.status, truncate(entry.notes ?? '', 120)]),
      ),
    )

  lines.push('', '### 跟随官方同步删除', '')
  if (report.removed.synced.length === 0) lines.push('_none_')
  else for (const id of report.removed.synced) lines.push(`- \`${id}\``)

  lines.push('', '## 其他台账条目（无 releaseItems）', '')
  if (report.unreferenced.length === 0) lines.push('_none_')
  else
    lines.push(
      ...renderTable(
        ['条目', '状态', '说明'],
        report.unreferenced.map((entry) => [entry.id, entry.status, truncate(entry.notes ?? '', 120)]),
      ),
    )

  lines.push('', '## 全量 release items', '')
  lines.push(
    ...renderTable(
      ['#', '状态', '台账条目', '官方说明'],
      report.releaseItems.map((row) => [
        String(row.item),
        statusSummary(row.entries),
        row.entries.length === 0 ? '—' : row.entries.map((entry) => entry.id).join(', '),
        truncate(row.text, 160),
      ]),
    ),
  )

  if (report.uncovered.length > 0 || report.unknown.length > 0) {
    lines.push('', '## 未覆盖 / 异常', '')
    for (const item of report.uncovered) {
      lines.push(`- #${item}: ${truncate(report.releaseItems[item - 1]?.text ?? '', 160)}`)
    }
    for (const unknown of report.unknown) lines.push(`- ${unknown}`)
  }

  lines.push(
    '',
    '---',
    '',
    '完整官方文本与台账 notes 见 `features.json`。inventory 的前缀扫描可能漏收非 `CLAUDE_CODE_*` 变量（如 `CLAUDE_REPL_MODE`），需人工登记后再生成。',
  )
  return `${lines.join('\n')}\n`
}

const PRINT_WIDTH = 120

function inlineJson(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = value.map(inlineJson)
    return items.some((item) => item === undefined) ? undefined : `[${items.join(', ')}]`
  }
  if (value !== null && typeof value === 'object') return undefined
  return JSON.stringify(value)
}

// oxfmt (Prettier-compatible) keeps arrays on one line when they fit within
// printWidth and always expands non-empty objects. `JSON.stringify(..., null, 2)`
// expands every array, which fails `oxfmt --check`.
function formatJson(value: unknown, indent = ''): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const inline = inlineJson(value)
    if (inline !== undefined && indent.length + inline.length <= PRINT_WIDTH) return inline
    const childIndent = `${indent}  `
    const items = value.map((item) => `${childIndent}${formatJson(item, childIndent)}`)
    return `[\n${items.join(',\n')}\n${indent}]`
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined)
    if (entries.length === 0) return '{}'
    const childIndent = `${indent}  `
    const lines = entries.map(([key, item]) => `${childIndent}${JSON.stringify(key)}: ${formatJson(item, childIndent)}`)
    return `{\n${lines.join(',\n')}\n${indent}}`
  }
  return JSON.stringify(value)
}

export async function writeFeaturesReport(report: FeaturesReport, outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, 'features.json'), `${formatJson(report)}\n`, 'utf8')
  await writeFile(join(outDir, 'features.md'), renderFeaturesMarkdown(report), 'utf8')
}
