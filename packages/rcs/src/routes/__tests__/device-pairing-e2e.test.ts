/**
 * 设备码配对的端到端测试：走真实 gateway 装配表 + 真实 PGlite 服务层，
 * 覆盖「免鉴权取码 → 登录态预览/批准 → 换出 rcs_ key（只发一次）→ 用该 key
 * 注册环境、建会话、查自己的 key 列表」整条链路。
 *
 * 与 routes.test.ts 里拆开测的设备端点/批准端点不同，这里只验证用户真正拿到的
 * 那把 key 能否当作用户登录态去授权后续所有请求——这是配对功能的最终目的。
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import type { Hono } from 'hono'

import { hashApiKey } from '@/auth/api-key'
import type { AppEnv } from '@/auth/context'
import { signAccessToken } from '@/auth/tokens'
import { loadConfig } from '@/config'
import type { UserRecord } from '@/contracts'
import type { Repositories } from '@/db/repositories/types'
import { createTestRepositories } from '@/db/testing'
import { createGateway } from '@/gateway'

const WEB_ORIGIN = 'http://e2e.local:4000'
const TRACKED_ENV = ['RCS_AUTH_SECRET', 'RCS_BASE_URL', 'RCS_WEB_URL', 'RCS_API_KEYS'] as const
const savedEnv: Partial<Record<(typeof TRACKED_ENV)[number], string>> = {}
for (const key of TRACKED_ENV) savedEnv[key] = process.env[key]

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

let repos: Repositories
let app: Hono<AppEnv>
let member: UserRecord
let memberToken: string

beforeEach(async () => {
  process.env.RCS_AUTH_SECRET = 'test-secret'
  process.env.RCS_BASE_URL = WEB_ORIGIN
  delete process.env.RCS_WEB_URL
  delete process.env.RCS_API_KEYS

  repos = await createTestRepositories()
  member = await repos.users.create({ username: 'member', passwordHash: 'x', role: 'member' })
  memberToken = await signAccessToken({ id: member.id, username: member.username, role: member.role })
  // Next's global types make NODE_ENV required on ProcessEnv; same cast as gateway.test.ts.
  const config = loadConfig({ RCS_AUTH_SECRET: 'test-secret' } as unknown as NodeJS.ProcessEnv)
  app = createGateway({ config, repos })
})

afterAll(() => {
  for (const key of TRACKED_ENV) {
    const value = savedEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

interface DeviceGrant {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

describe('device pairing end-to-end', () => {
  test('the paired key authenticates the user across v1 and web routes', async () => {
    // 1. 插件在无凭据时发起配对：公开端点，无需鉴权。
    const codeRes = await app.request('/v1/auth/device/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client: 'dsh-rcs-plugin', hostname: 'e2e-mac' }),
    })
    expect(codeRes.status).toBe(200)
    const grant = await json<DeviceGrant>(codeRes)
    expect(grant.verification_uri).toBe(`${WEB_ORIGIN}/device`)
    expect(grant.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(grant.device_code.length).toBeGreaterThan(20)

    // 2. 用户尚未批准：轮询仍是 pending。
    const pending = await app.request('/v1/auth/device/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: grant.device_code }),
    })
    expect((await json<{ status: string }>(pending)).status).toBe('pending')

    // 3. 登录用户在 /device 预览机器信息（小写+连字符也能识别），随后批准。
    const preview = await app.request(`/web/auth/device/${grant.user_code.toLowerCase()}`, {
      headers: bearer(memberToken),
    })
    expect(preview.status).toBe(200)
    expect(await json(preview)).toMatchObject({ client: 'dsh-rcs-plugin', hostname: 'e2e-mac', status: 'pending' })

    const approve = await app.request('/web/auth/device/approve', {
      method: 'POST',
      headers: bearer(memberToken),
      body: JSON.stringify({ user_code: grant.user_code }),
    })
    expect(approve.status).toBe(200)
    expect(await json(approve)).toEqual({ ok: true, name: 'dsh @ e2e-mac' })

    // 4. 插件轮询换出 key：只发一次，命名沿用批准页展示的机器名。
    const token = await app.request('/v1/auth/device/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: grant.device_code }),
    })
    expect(token.status).toBe(200)
    const issued = await json<{ status: string; api_key: string; prefix: string; name: string }>(token)
    expect(issued).toMatchObject({ status: 'approved', name: 'dsh @ e2e-mac' })
    expect(issued.api_key.startsWith('rcs_')).toBe(true)
    expect(issued.prefix.startsWith('rcs_')).toBe(true)

    // 5. 一次性：再次轮询、再次批准都失败，设备码行已被消费且记在 member 名下。
    const replay = await app.request('/v1/auth/device/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: grant.device_code }),
    })
    expect(replay.status).toBe(404)
    const codeRow = await repos.deviceCodes.findByDeviceCodeHash(hashApiKey(grant.device_code))
    expect(codeRow?.consumedAt).not.toBeNull()
    expect(codeRow?.approvedByUserId).toBe(member.id)
    expect(await repos.apiKeys.getByHash(hashApiKey(issued.api_key))).toMatchObject({ userId: member.id })

    // 6. 用这把 key 真实注册环境：服务端把它当成 member 本人。
    const registered = await app.request('/v1/environments/bridge', {
      method: 'POST',
      headers: bearer(issued.api_key),
      body: JSON.stringify({
        machine_name: 'e2e-mac',
        directory: '/tmp/e2e',
        max_sessions: 2,
        worker_type: 'deepseek',
      }),
    })
    expect(registered.status).toBe(200)
    const envResult = await json<{ environment_id: string; environment_secret: string; status: string }>(registered)
    const environment = await repos.environments.getById(envResult.environment_id)
    expect(environment?.ownerUserId).toBe(member.id)
    expect(environment?.maxSessions).toBe(2)

    // 7. 用这把 key 建会话，归属同样是 member。
    const session = await app.request('/v1/sessions', {
      method: 'POST',
      headers: bearer(issued.api_key),
      body: JSON.stringify({ title: 'e2e session' }),
    })
    expect(session.status).toBe(200)
    expect((await json<{ owner_user_id: string }>(session)).owner_user_id).toBe(member.id)

    // 8. 这把 key 出现在用户自己的 /web/api-keys 列表里（元数据，不含明文）。
    const keys = await app.request('/web/api-keys', { headers: bearer(issued.api_key) })
    expect(keys.status).toBe(200)
    const list = await json<Array<{ name: string }>>(keys)
    expect(list.some((entry) => entry.name === 'dsh @ e2e-mac')).toBe(true)
  })
})
