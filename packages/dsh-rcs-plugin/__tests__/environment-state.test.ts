import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { bridgeStateDir, readEnvironmentId, writeEnvironmentId } from '../src/environment-state'

describe('environment state', () => {
  test('write then read round-trips with a 0600 file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rcs-env-state-'))
    await writeEnvironmentId(dir, 'env_123')
    expect(await readEnvironmentId(dir)).toBe('env_123')
    const info = await stat(join(dir, 'environment.json'))
    expect(info.mode & 0o777).toBe(0o600)
    const parsed: unknown = JSON.parse(await readFile(join(dir, 'environment.json'), 'utf8'))
    expect(parsed).toEqual({ version: 1, environmentId: 'env_123' })
  })

  test('a missing or corrupt file yields undefined', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rcs-env-state-'))
    expect(await readEnvironmentId(dir)).toBeUndefined()
    await writeFile(join(dir, 'environment.json'), '{not json')
    expect(await readEnvironmentId(dir)).toBeUndefined()
  })

  test('bridgeStateDir honors DSH_HOME', () => {
    expect(bridgeStateDir({ DSH_HOME: '/tmp/dsh' })).toBe(join('/tmp/dsh', 'rcs-bridge'))
    expect(bridgeStateDir({})).toBe(join(homedir(), '.dsh', 'rcs-bridge'))
  })
})
