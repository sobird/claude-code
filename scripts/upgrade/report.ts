import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { VerifyReport } from './types'

const SECTIONS: Array<{ key: keyof VerifyReport; title: string }> = [
  { key: 'ledgerErrors', title: 'Ledger errors' },
  { key: 'missingInSrc', title: 'Missing in src' },
  { key: 'unexpectedInSrc', title: 'Unexpected in src' },
  { key: 'unregistered', title: 'Unregistered' },
  { key: 'unresolved', title: 'Unresolved' },
  { key: 'evidenceErrors', title: 'Evidence errors' },
  { key: 'srcEvidenceErrors', title: 'Src evidence errors' },
  { key: 'uncoveredReleaseItems', title: 'Uncovered release items' },
]

// oxfmt aligns markdown tables by display width, where East Asian wide chars
// occupy two columns. JS `.length` counts code units, so a table with CJK cells
// would be mis-padded and fail `oxfmt --check`.
function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    code === 0x2329 ||
    code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
}

function displayWidth(value: string): number {
  let width = 0
  for (const char of value) width += isWide(char.codePointAt(0) ?? 0) ? 2 : 1
  return width
}

function pad(value: string, width: number): string {
  return value + ' '.repeat(Math.max(0, width - displayWidth(value)))
}

// Render a markdown table padded to a stable column width. oxfmt aligns tables
// this way, so generated output passes `oxfmt --check` without a separate pass.
export function renderTable(header: string[], rows: string[][]): string[] {
  const widths = header.map((cell, column) =>
    Math.max(displayWidth(cell), ...rows.map((row) => displayWidth(row[column]))),
  )
  const renderRow = (cells: string[]): string =>
    `| ${cells.map((cell, column) => pad(cell, widths[column])).join(' | ')} |`
  return [renderRow(header), `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`, ...rows.map(renderRow)]
}

export function renderMarkdown(report: VerifyReport): string {
  const lines: string[] = ['# Upgrade verification report', '', `OK: ${report.ok}`, '']
  const countRows = Object.entries(report.counts).map(([status, count]) => [status, String(count)])
  lines.push(...renderTable(['Status', 'Count'], countRows))
  for (const section of SECTIONS) {
    const ids = report[section.key] as string[]
    if (ids.length === 0) continue
    lines.push('', `## ${section.title}`, '')
    for (const id of ids) lines.push(`- ${id}`)
  }
  return `${lines.join('\n')}\n`
}

export async function writeReport(report: VerifyReport, outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(join(outDir, 'report.md'), renderMarkdown(report), 'utf8')
}
