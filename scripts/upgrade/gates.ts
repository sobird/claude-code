/**
 * Baseline gate comparison.
 *
 * The repo carries a pre-existing typecheck/lint backlog, so "did my change add
 * errors?" cannot be answered by looking at the current output alone. This
 * checks out `--ref` in a temporary worktree (sharing node_modules), runs the
 * same gates there and in the working tree, normalizes away line/column drift
 * and root paths, and diffs the result as a multiset of lines.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export type GateName = 'typecheck' | 'lint' | 'test'

export const GATE_COMMANDS: Record<GateName, string[]> = {
  typecheck: ['bun', 'run', 'typecheck'],
  lint: ['bun', 'run', 'lint'],
  test: ['bun', 'test'],
}

export type GateResult = {
  gate: GateName
  baselineExit: number | null
  currentExit: number | null
  added: string[]
  removed: string[]
}

export type GatesResult = {
  ref: string
  gates: GateResult[]
}

export type GatesOptions = {
  ref: string
  repoRoot: string
  gates?: GateName[]
}

// oxlint-disable-next-line no-control-regex -- stripping ANSI escapes requires matching ESC itself
const ANSI_RE = /\u001b\[[0-9;]*m/g
const PAREN_POSITION_RE = /\(\d+,\d+\)/g
const COLON_POSITION_RE = /(\.[cm]?[jt]sx?):\d+:\d+/g
const MORE_RE = /\b\d+ more \.\.\./g
const DURATION_RE = /\[\d+(?:\.\d+)?m?s\]/g
// tsc truncates long module specifiers differently depending on path length,
// so the surviving text is not even a prefix we can root-replace.
const MODULE_RE = /import\("[^"]*"\)/g
const LINE_REF_RE = /\bline \d+\b/g
const FILES_COUNT_RE = /\bon \d+ files\b/g

// Dependency lists come from object iteration and flip order between runs
// without the finding changing.
function sortDependencies(line: string): string {
  const match = /^(.*has missing dependencies: )(.*)$/.exec(line)
  const names = match?.[2].match(/'[^']+'/g)
  return match && names ? match[1] + names.toSorted().join(', ') : line
}

function canonicalize(text: string): string[] {
  return text
    .replace(PAREN_POSITION_RE, '(L,C)')
    .replace(COLON_POSITION_RE, '$1:L:C')
    .replace(MORE_RE, 'N more ...')
    .replace(DURATION_RE, '[T]')
    .replace(/Finished in \d+(?:\.\d+)?m?s/, 'Finished in T')
    .replace(/\bFound \d+ warnings and \d+ errors\./, 'Found N warnings and N errors.')
    .replace(MODULE_RE, 'import("<MODULE>")')
    .replace(LINE_REF_RE, 'line L')
    .replace(FILES_COUNT_RE, 'on N files')
    .split('\n')
    .map((line) => sortDependencies(line.trim()))
    .filter((line) => line.length > 0)
}

// Line/column drift is noise: an edit above a diagnostic must not look like a
// new finding. Type-expansion counts ("82 more"), test durations and lint's
// "already resolved on line N" move for the same reason.

// Typecheck elaborates each error over many indented lines whose truncation
// depends on path lengths, and lint prints a code frame. Keep the finding's
// file + TS code (message bodies embed unstable type displays) and the lint
// header/message, dropping the elaboration so the diff tracks findings.
function findingLines(lines: string[], gate: GateName): string[] {
  if (gate === 'typecheck') {
    return lines
      .map((line) => /^(.*?\(L,C\): (?:error|warning) TS\d+):.*$/.exec(line)?.[1] ?? line)
      .filter((line) => /\(L,C\): (?:error|warning) TS\d+/.test(line) || /^error TS\d+/.test(line))
  }
  if (gate === 'lint') {
    return lines.filter((line) => !/^\s*\d+ \|/.test(line) && !/^\s*:\s*\^+\s*$/.test(line) && !/^\s*`-+$/.test(line))
  }
  if (gate === 'test') {
    // Bun prints failures as `(fail) name`; everything else is stack/console noise.
    return lines.filter((line) => line.startsWith('(fail) '))
  }
  return lines
}

export function normalizeGateOutput(raw: string, roots: string[], gate?: GateName): string[] {
  let text = raw.replace(ANSI_RE, '')
  for (const root of [...roots].toSorted((a, b) => b.length - a.length)) {
    if (root.length === 0) continue
    text = text.split(root).join('<ROOT>')
  }
  const lines = canonicalize(text)
  return gate ? findingLines(lines, gate) : lines
}

// Multiset difference: a line that merely moved still matches, while a line
// that appears more often than before is reported as added.
export function diffMultiset(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const counts = new Map<string, number>()
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1)
  const added: string[] = []
  for (const line of after) {
    const count = counts.get(line) ?? 0
    if (count > 0) counts.set(line, count - 1)
    else added.push(line)
  }
  const removed: string[] = []
  for (const [line, count] of counts) for (let i = 0; i < count; i++) removed.push(line)
  return { added: added.toSorted(), removed: removed.toSorted() }
}

function runGate(command: string[], cwd: string): { exit: number | null; output: string } {
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    encoding: 'utf8',
    timeout: 15 * 60_000,
    maxBuffer: 128 * 1024 * 1024,
    env: process.env,
  })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  return { exit: result.error ? null : result.status, output }
}

function runGit(args: string[], cwd: string): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.error) throw new Error(`failed to run git: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  return result.stdout
}

export function runGates(opts: GatesOptions): GatesResult {
  const repoRoot = resolve(opts.repoRoot)
  const gates = opts.gates ?? (Object.keys(GATE_COMMANDS) as GateName[])
  const tempRoot = mkdtempSync(join(tmpdir(), 'upgrade-gates-'))
  const worktree = join(tempRoot, 'baseline')

  try {
    runGit(['worktree', 'add', '--detach', worktree, opts.ref], repoRoot)

    if (existsSync(join(repoRoot, 'node_modules'))) {
      symlinkSync(join(repoRoot, 'node_modules'), join(worktree, 'node_modules'), 'dir')
    }

    const roots = [repoRoot, worktree]
    for (const path of [repoRoot, worktree]) {
      try {
        roots.push(realpathSync(path))
      } catch {
        // the path vanished; keep the literal form only
      }
    }

    const results: GateResult[] = []
    for (const gate of gates) {
      const command = GATE_COMMANDS[gate]
      const baseline = runGate(command, worktree)
      const current = runGate(command, repoRoot)
      const diff = diffMultiset(
        normalizeGateOutput(baseline.output, roots, gate),
        normalizeGateOutput(current.output, roots, gate),
      )
      results.push({ gate, baselineExit: baseline.exit, currentExit: current.exit, ...diff })
    }

    return { ref: opts.ref, gates: results }
  } finally {
    try {
      spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: repoRoot, encoding: 'utf8' })
    } catch {
      // best-effort cleanup; the temp dir removal below still applies
    }
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

export function renderGatesMarkdown(result: GatesResult): string {
  const lines: string[] = ['# Baseline gate comparison', '', `Reference: ${result.ref}`, '']
  for (const gate of result.gates) {
    lines.push(`## ${gate.gate}`, '')
    lines.push(`Baseline exit: ${gate.baselineExit ?? 'error'}; current exit: ${gate.currentExit ?? 'error'}`, '')
    if (gate.added.length === 0 && gate.removed.length === 0) {
      lines.push('No new findings.', '')
      continue
    }
    if (gate.added.length > 0) {
      lines.push('### Added', '')
      for (const line of gate.added) lines.push(`- \`${line}\``)
      lines.push('')
    }
    if (gate.removed.length > 0) {
      lines.push('### Removed', '')
      for (const line of gate.removed) lines.push(`- \`${line}\``)
      lines.push('')
    }
  }
  return `${lines.join('\n')}\n`
}

export async function writeGatesReport(result: GatesResult, outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, 'gates.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  await writeFile(join(outDir, 'gates.md'), renderGatesMarkdown(result), 'utf8')
}
