import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { executeSession } from '../sessionExecutor.js'

const tmp = mkdtempSync(join(tmpdir(), 'env-runner-exec-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function writeScript(name: string, body: string): string {
  const path = join(tmp, name)
  writeFileSync(path, body)
  return path
}

const PRINT_AND_EXIT = "process.stdout.write('child-output\\n'); process.exit(Number(process.env.EXIT_CODE ?? '0'))"
const SLEEP = 'setTimeout(() => {}, 60_000)'

describe('executeSession', () => {
  test('reports completed and forwards stdout on exit 0', async () => {
    const script = writeScript('ok.js', PRINT_AND_EXIT)
    let stdout = ''
    const result = await executeSession({
      launch: { command: process.execPath, args: [script] },
      cwd: tmp,
      env: { ...process.env, EXIT_CODE: '0' },
      onStdout: (chunk) => {
        stdout += chunk
      },
    })
    expect(result.status).toBe('completed')
    expect(result.code).toBe(0)
    expect(stdout).toContain('child-output')
  })

  test('reports failed with the child exit code', async () => {
    const script = writeScript('fail.js', PRINT_AND_EXIT)
    const result = await executeSession({
      launch: { command: process.execPath, args: [script] },
      cwd: tmp,
      env: { ...process.env, EXIT_CODE: '2' },
    })
    expect(result.status).toBe('failed')
    expect(result.code).toBe(2)
  })

  test('reports interrupted when the abort signal fires', async () => {
    const script = writeScript('sleep.js', SLEEP)
    const controller = new AbortController()
    const pending = executeSession({
      launch: { command: process.execPath, args: [script] },
      cwd: tmp,
      env: { ...process.env },
      signal: controller.signal,
      killGraceMs: 200,
    })
    setTimeout(() => controller.abort(), 50)
    const result = await pending
    expect(result.status).toBe('interrupted')
  })
})
