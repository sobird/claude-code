import { describe, expect, test } from 'bun:test'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readCredentials, writeCredentials } from '../src/credentials'
import { ensureCredentials, type DeviceAuthLike } from '../src/credentials-flow'
import type { DeviceGrant, DeviceTokenResult } from '../src/device-auth'

const GRANT: DeviceGrant = {
  deviceCode: 'device-code',
  userCode: 'ABCD-2345',
  verificationUri: 'https://rcs.example.com/device',
  verificationUriComplete: 'https://rcs.example.com/device#code=ABCD-2345',
  expiresIn: 600,
  interval: 5,
}

const BASE = 'https://rcs.example.com'

interface ClientHarness {
  client: DeviceAuthLike
  calls: { requestCode: number; pollToken: number }
}

function scriptedClient(tokens: DeviceTokenResult[], onRequest?: () => void): ClientHarness {
  const calls = { requestCode: 0, pollToken: 0 }
  let index = 0
  return {
    calls,
    client: {
      async requestCode() {
        calls.requestCode += 1
        onRequest?.()
        return GRANT
      },
      async pollToken() {
        calls.pollToken += 1
        const next = tokens[index]
        index += 1
        return next ?? { status: 'pending', apiKey: undefined }
      },
    },
  }
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'rcs-credentials-flow-'))
}

function throwawayClient(): DeviceAuthLike {
  return {
    async requestCode() {
      throw new Error('network should not be used')
    },
    async pollToken() {
      throw new Error('network should not be used')
    },
  }
}

describe('ensureCredentials', () => {
  test('reuses a stored credential for the same base URL without touching the network', async () => {
    const dir = await tempDir()
    await writeCredentials(dir, {
      version: 1,
      rcsBaseUrl: `${BASE}/`,
      apiKey: 'rcs_stored',
      createdAt: '2026-11-24T00:00:00.000Z',
    })

    const key = await ensureCredentials(
      { rcsBaseUrl: BASE },
      { stateDir: dir, client: throwawayClient(), openUrl: () => {}, log: () => {} },
    )
    expect(key).toBe('rcs_stored')
  })

  test('re-pairs and overwrites the file when the base URL changed', async () => {
    const dir = await tempDir()
    await writeCredentials(dir, {
      version: 1,
      rcsBaseUrl: 'https://other.example.com',
      apiKey: 'rcs_old',
      createdAt: '2026-11-24T00:00:00.000Z',
    })

    const { client, calls } = scriptedClient([{ status: 'approved', apiKey: 'rcs_new' }])
    const logs: string[] = []
    const opened: string[] = []
    const key = await ensureCredentials(
      { rcsBaseUrl: BASE },
      { stateDir: dir, client, openUrl: (url) => opened.push(url), log: (line) => logs.push(line) },
    )

    expect(key).toBe('rcs_new')
    expect(calls.requestCode).toBe(1)
    // 浏览器打开带 fragment 的完整链接；日志只留 base URL（fragment 不进日志）。
    expect(opened).toEqual(['https://rcs.example.com/device#code=ABCD-2345'])
    expect(logs.some((line) => line.includes('ABCD-2345'))).toBe(true)
    expect(logs.some((line) => line.includes('#code='))).toBe(false)
    expect((await readCredentials(dir))?.apiKey).toBe('rcs_new')
    expect((await stat(join(dir, 'credentials.json'))).mode & 0o777).toBe(0o600)
  })

  test('polls through pending attempts before succeeding', async () => {
    const dir = await tempDir()
    const { client, calls } = scriptedClient([
      { status: 'pending', apiKey: undefined },
      { status: 'pending', apiKey: undefined },
      { status: 'approved', apiKey: 'rcs_ok' },
    ])

    const key = await ensureCredentials(
      { rcsBaseUrl: BASE },
      {
        stateDir: dir,
        client,
        openUrl: () => {},
        log: () => {},
        sleep: async () => {},
        now: () => 0,
      },
    )
    expect(key).toBe('rcs_ok')
    expect(calls.pollToken).toBe(3)
  })

  test('force skips the stored credential', async () => {
    const dir = await tempDir()
    await writeCredentials(dir, {
      version: 1,
      rcsBaseUrl: BASE,
      apiKey: 'rcs_stored',
      createdAt: '2026-11-24T00:00:00.000Z',
    })

    const { client, calls } = scriptedClient([{ status: 'approved', apiKey: 'rcs_fresh' }])
    const key = await ensureCredentials(
      { rcsBaseUrl: BASE },
      { stateDir: dir, client, openUrl: () => {}, log: () => {}, force: true },
    )
    expect(key).toBe('rcs_fresh')
    expect(calls.requestCode).toBe(1)
  })

  test('throws when the code expires', async () => {
    const dir = await tempDir()
    const { client } = scriptedClient([{ status: 'expired', apiKey: undefined }])
    await expect(
      ensureCredentials(
        { rcsBaseUrl: BASE },
        { stateDir: dir, client, openUrl: () => {}, log: () => {}, sleep: async () => {}, now: () => 0 },
      ),
    ).rejects.toThrow(/expired/)
  })

  test('throws after the grant lifetime elapses', async () => {
    const dir = await tempDir()
    const { client } = scriptedClient([])
    let clock = 0
    await expect(
      ensureCredentials(
        { rcsBaseUrl: BASE },
        {
          stateDir: dir,
          client,
          openUrl: () => {},
          log: () => {},
          sleep: async (ms) => {
            clock += ms
          },
          now: () => clock,
        },
      ),
    ).rejects.toThrow(/timed out/)
  })
})
