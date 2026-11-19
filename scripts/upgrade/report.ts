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

function pad(value: string, width: number): string {
  return value.padEnd(width, ' ')
}

// Render a markdown table padded to a stable column width. oxfmt aligns tables
// this way, so generated output passes `oxfmt --check` without a separate pass.
function renderTable(header: string[], rows: string[][]): string[] {
  const widths = header.map((cell, column) => Math.max(cell.length, ...rows.map((row) => row[column].length)))
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
