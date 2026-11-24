import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agentIdForRcs, readSidecar, recordSync, rcsIdForAgent } from '../src/sidecar'

describe('sidecar', () => {
  test('recordSync round-trips and looks up both ways', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rcs-sidecar-'))
    await recordSync(dir, 'session-a', 'cse_a')
    const map = await readSidecar(dir)
    expect(agentIdForRcs(map, 'cse_a')).toBe('session-a')
    expect(rcsIdForAgent(map, 'session-a')).toBe('cse_a')
    const info = await stat(join(dir, 'sessions.json'))
    expect(info.mode & 0o777).toBe(0o600)
  })

  test('a corrupt sidecar is renamed and treated as empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rcs-sidecar-'))
    await writeFile(join(dir, 'sessions.json'), '{not json')
    expect(await readSidecar(dir)).toEqual({})
    expect(await readFile(join(dir, 'sessions.json.bak'), 'utf8')).toBe('{not json')
  })
})
