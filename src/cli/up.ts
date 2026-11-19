/**
 * `claude up` (ant-only) — initialize or upgrade the local dev environment by
 * running the shell snippets under the "# claude up" heading of the nearest
 * CLAUDE.md. Fenced ```bash/```sh blocks are run in order; when the section has
 * no fences its body is treated as a single shell script.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { getCwd } from '../utils/cwd.js'
import { execFileNoThrowWithCwd } from '../utils/execFileNoThrow.js'

const SECTION_HEADING = /^#{1,6}\s+claude up\s*$/i
const HEADING = /^(#{1,6})\s/
const SHELL_FENCE = /```(?:bash|sh|shell|zsh)\n([\s\S]*?)```/g
const STEP_TIMEOUT_MS = 10 * 60 * 1000

async function findNearestClaudeMd(start: string): Promise<string | null> {
  let dir = start
  for (;;) {
    for (const candidate of ['CLAUDE.md', join('.claude', 'CLAUDE.md')]) {
      const path = join(dir, candidate)
      try {
        await readFile(path, 'utf8')
        return path
      } catch {
        // Keep walking.
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Returns the body of the "# claude up" section, up to the next heading of
 * the same or higher level. */
function extractClaudeUpSection(markdown: string): string | null {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => SECTION_HEADING.test(line.trim()))
  if (start === -1) return null

  const level = lines[start]?.match(HEADING)?.[1]?.length ?? 1
  const body: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const heading = lines[i]?.match(HEADING)
    if (heading && heading[1] && heading[1].length <= level) break
    body.push(lines[i] ?? '')
  }
  return body.join('\n').trim()
}

function extractScripts(section: string): string[] {
  const scripts: string[] = []
  for (const match of section.matchAll(SHELL_FENCE)) {
    const script = match[1]?.trim()
    if (script) scripts.push(script)
  }
  return scripts.length > 0 ? scripts : section.trim() ? [section.trim()] : []
}

export async function up(): Promise<void> {
  const claudeMdPath = await findNearestClaudeMd(getCwd())
  if (!claudeMdPath) {
    console.error('No CLAUDE.md found in this directory or any parent.')
    process.exitCode = 1
    return
  }

  const markdown = await readFile(claudeMdPath, 'utf8')
  const section = extractClaudeUpSection(markdown)
  if (section === null) {
    console.error(`No "# claude up" section found in ${claudeMdPath}.`)
    process.exitCode = 1
    return
  }

  const scripts = extractScripts(section)
  if (scripts.length === 0) {
    console.log(`The "# claude up" section in ${claudeMdPath} is empty; nothing to do.`)
    return
  }

  const cwd = dirname(claudeMdPath)
  console.log(`Running ${scripts.length} setup step${scripts.length === 1 ? '' : 's'} from ${claudeMdPath}`)

  for (const [index, script] of scripts.entries()) {
    console.log(`\n[${index + 1}/${scripts.length}]`)
    const shell = process.platform === 'win32' ? 'cmd' : '/bin/sh'
    const result = await execFileNoThrowWithCwd(shell, ['-c', script], {
      cwd,
      timeout: STEP_TIMEOUT_MS,
    })
    if (result.stdout.trim()) process.stdout.write(result.stdout)
    if (result.stderr.trim()) process.stderr.write(result.stderr)
    if (result.code !== 0) {
      console.error(`\nSetup step ${index + 1} failed (exit ${result.code}).`)
      process.exitCode = 1
      return
    }
  }

  console.log('\nDone.')
}
