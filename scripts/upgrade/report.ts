import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { VerifyReport } from './types'

const SECTIONS: Array<{ key: keyof VerifyReport; title: string }> = [
  { key: 'missingInSrc', title: 'Missing in src' },
  { key: 'unexpectedInSrc', title: 'Unexpected in src' },
  { key: 'unregistered', title: 'Unregistered' },
  { key: 'unresolved', title: 'Unresolved' },
]

function renderMarkdown(report: VerifyReport): string {
  const lines: string[] = ['# Upgrade verification report', '', `OK: ${report.ok}`, '']
  lines.push('| Status | Count |', '| --- | --- |')
  for (const [status, count] of Object.entries(report.counts)) {
    lines.push(`| ${status} | ${count} |`)
  }
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
