import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { enrichLogs, getSessionFilesLite } from '../sessionStorage.js'

const dirs: string[] = []

afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop()!, { recursive: true, force: true })
  }
})

async function enrichSession(entry: Record<string, unknown>): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), 'resume-filters-'))
  dirs.push(dir)
  const sessionId = randomUUID()
  await writeFile(
    join(dir, `${sessionId}.jsonl`),
    `${JSON.stringify({ type: 'user', cwd: '/repo', sessionId, message: { content: 'hello there' }, ...entry })}\n`,
  )
  const lite = await getSessionFilesLite(dir)
  const { logs } = await enrichLogs(lite, 0, 10)
  return logs.length
}

describe('/resume session filters', () => {
  test('keeps plain CLI sessions', async () => {
    expect(await enrichSession({ entrypoint: 'cli' })).toBe(1)
  })

  test('filters SDK-created sessions', async () => {
    expect(await enrichSession({ entrypoint: 'sdk-cli' })).toBe(0)
    expect(await enrichSession({ entrypoint: 'sdk-ts' })).toBe(0)
    expect(await enrichSession({ entrypoint: 'sdk-py' })).toBe(0)
  })

  test('filters /loop sessions', async () => {
    expect(await enrichSession({ message: { content: '<command-name>/loop</command-name>' } })).toBe(0)
  })

  test('filters background/daemon session kinds', async () => {
    expect(await enrichSession({ sessionKind: 'bg' })).toBe(0)
    expect(await enrichSession({ sessionKind: 'daemon' })).toBe(0)
    expect(await enrichSession({ sessionKind: 'daemon-worker' })).toBe(0)
  })

  test('keeps other session kinds', async () => {
    expect(await enrichSession({ sessionKind: 'interactive' })).toBe(1)
  })
})
