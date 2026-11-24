import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { clearCredentials, readCredentials, writeCredentials } from '../src/credentials'

const CREDS = {
  version: 1 as const,
  rcsBaseUrl: 'https://rcs.example.com',
  apiKey: 'rcs_test_key',
  createdAt: '2026-11-24T00:00:00.000Z',
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'rcs-credentials-'))
}

describe('credentials', () => {
  test('write then read round-trips with a 0600 file', async () => {
    const dir = await tempDir()
    await writeCredentials(dir, CREDS)
    expect(await readCredentials(dir)).toEqual(CREDS)
    const info = await stat(join(dir, 'credentials.json'))
    expect(info.mode & 0o777).toBe(0o600)
  })

  test('a missing directory yields null', async () => {
    const dir = await tempDir()
    expect(await readCredentials(join(dir, 'missing'))).toBeNull()
  })

  test('corrupt or malformed files are moved to .bak and read as null', async () => {
    const dir = await tempDir()
    const target = join(dir, 'credentials.json')

    await writeFile(target, '{not json')
    expect(await readCredentials(dir)).toBeNull()
    expect(await Bun.file(target).exists()).toBe(false)
    expect(await readFile(`${target}.bak`, 'utf8')).toBe('{not json')

    await writeFile(target, JSON.stringify({ version: 2, rcsBaseUrl: 1 }))
    expect(await readCredentials(dir)).toBeNull()
  })

  test('non-ENOENT read errors propagate', async () => {
    const dir = await tempDir()
    // 目录冒充文件：readFile 抛 EISDIR，不能当作「没有凭据」吞掉。
    await mkdir(join(dir, 'credentials.json'))
    await expect(readCredentials(dir)).rejects.toThrow()
  })

  test('clear is idempotent', async () => {
    const dir = await tempDir()
    await writeCredentials(dir, CREDS)
    await clearCredentials(dir)
    expect(await readCredentials(dir)).toBeNull()
    await clearCredentials(dir)
  })
})
