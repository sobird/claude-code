import { describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
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

  // 只有「不存在」才等于空表；权限等问题必须暴露出来，否则会把可修复的配置错误静默吞掉。
  test.skipIf(process.getuid?.() === 0)('a permission error propagates instead of reading as empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rcs-sidecar-'))
    const path = join(dir, 'sessions.json')
    await writeFile(path, JSON.stringify({ version: 1, sessions: {} }))
    await chmod(path, 0o000)
    try {
      await expect(readSidecar(dir)).rejects.toThrow()
    } finally {
      await chmod(path, 0o600)
    }
  })
})
