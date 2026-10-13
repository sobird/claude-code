#!/usr/bin/env node
// PostToolUse (Write|Edit) hook: format the just-edited file with the project's oxfmt.
// Reads the hook payload on stdin. Never blocks the tool: any failure exits 0.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectDir = process.env.CLAUDE_PROJECT_DIR || resolve(scriptDir, '..', '..')

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => (raw += chunk))
process.stdin.on('end', () => {
  let file
  try {
    const payload = JSON.parse(raw)
    file = payload.tool_input?.file_path || payload.tool_response?.filePath
  } catch {
    process.exit(0)
  }
  if (!file || !existsSync(file)) process.exit(0)

  const localBin = resolve(projectDir, 'node_modules', '.bin', 'oxfmt')
  const [cmd, args] = existsSync(localBin)
    ? [localBin, ['--no-error-on-unmatched-pattern', file]]
    : ['npx', ['oxfmt', '--no-error-on-unmatched-pattern', file]]

  try {
    execFileSync(cmd, args, { cwd: projectDir, stdio: 'ignore' })
  } catch {
    // Formatting is best-effort; don't surface failures to the tool call.
  }
  process.exit(0)
})
