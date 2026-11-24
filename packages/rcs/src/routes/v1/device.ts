/**
 * 设备码配对的公开端点（RFC 8628 简化版）：插件无需先有凭据即可换取 API key。
 *
 * 服务器不存明文 key：`/code` 只下发设备码与短码；用户在 Web 端批准后，`/token`
 * 先原子占行（`consumed_at`）再铸 key，并只返回一次。此后重复轮询一律 404，
 * 因此并发轮询最多铸出一把 key。
 */

import { randomBytes } from 'node:crypto'

import { Hono } from 'hono'
import type { Context } from 'hono'

import { generateApiKey, hashApiKey } from '@/auth/api-key'
import type { AppEnv } from '@/auth/context'
import { loadConfig } from '@/config'
import { getClientIp } from '@/lib/client-ip'
import { createRateLimiter } from '@/lib/rate-limit'
import { readJson } from '@/routes/common'

const app = new Hono<AppEnv>()

const EXPIRES_IN_SECONDS = 600
const POLL_INTERVAL_SECONDS = 5
/** 过期行再保留一天，便于 token 端点回报 `expired` 而不是直接消失。 */
const EXPIRED_RETENTION_MS = 24 * 60 * 60 * 1000

/** 去掉易混淆字符 I/O；32 个符号让 `randomBytes` 取模无偏。 */
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const USER_CODE_LENGTH = 8

const codeLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 })
const tokenLimiter = createRateLimiter({ limit: 120, windowMs: 60_000 })

function rateLimited(c: Context<AppEnv>) {
  return c.json({ error: { type: 'rate_limited', message: 'Too many requests' } }, 429)
}

function unknownCode(c: Context<AppEnv>) {
  return c.json({ error: { type: 'not_found', message: 'Unknown device code' } }, 404)
}

/** 生成 `XXXX-XXXX` 展示码；落库时去掉连字符。 */
function generateUserCode(): string {
  const bytes = randomBytes(USER_CODE_LENGTH)
  let raw = ''
  for (const byte of bytes) raw += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length]
  return `${raw.slice(0, 4)}-${raw.slice(4)}`
}

/** POST /v1/auth/device/code — 发起配对，返回设备码与用户短码。 */
app.post('/code', async (c) => {
  const repos = c.get('repos')
  if (!codeLimiter.check(getClientIp(c.req.raw.headers))) return rateLimited(c)

  const body = await readJson(c)
  const client = typeof body.client === 'string' && body.client.trim() ? body.client.trim() : null
  const hostname = typeof body.hostname === 'string' && body.hostname.trim() ? body.hostname.trim() : null

  const now = new Date()
  const deviceCode = randomBytes(32).toString('base64url')
  const formattedCode = generateUserCode()

  // 顺手清理长期过期的行，避免表无限增长。
  await repos.deviceCodes.deleteExpiredBefore(new Date(now.getTime() - EXPIRED_RETENTION_MS))
  await repos.deviceCodes.create({
    deviceCodeHash: hashApiKey(deviceCode),
    userCode: formattedCode.replace('-', ''),
    clientName: client,
    hostname,
    expiresAt: new Date(now.getTime() + EXPIRES_IN_SECONDS * 1000),
  })

  return c.json(
    {
      device_code: deviceCode,
      user_code: formattedCode,
      verification_uri: `${loadConfig().webUrl}/device`,
      expires_in: EXPIRES_IN_SECONDS,
      interval: POLL_INTERVAL_SECONDS,
    },
    200,
  )
})

/** POST /v1/auth/device/token — 轮询状态；批准后一次性返回铸好的 key。 */
app.post('/token', async (c) => {
  const repos = c.get('repos')
  if (!tokenLimiter.check(getClientIp(c.req.raw.headers))) return rateLimited(c)

  const body = await readJson(c)
  const deviceCode = typeof body.device_code === 'string' ? body.device_code.trim() : ''
  if (!deviceCode) return unknownCode(c)

  const hash = hashApiKey(deviceCode)
  const now = new Date()

  // 先尝试占行：条件更新保证「approve 且未消费且未过期」才成功。
  const claimed = await repos.deviceCodes.claim(hash, now)
  if (claimed?.approvedByUserId) {
    const generated = generateApiKey()
    const name = `dsh @ ${claimed.hostname || claimed.clientName || 'machine'}`
    await repos.apiKeys.create({
      userId: claimed.approvedByUserId,
      name,
      prefix: generated.prefix,
      hash: generated.hash,
    })
    return c.json({ status: 'approved', api_key: generated.raw, prefix: generated.prefix, name }, 200)
  }

  const row = await repos.deviceCodes.findByDeviceCodeHash(hash)
  if (!row || row.consumedAt) return unknownCode(c)
  if (row.expiresAt.getTime() <= now.getTime()) return c.json({ status: 'expired' }, 200)
  // 已批准却没能占行：并发的轮询已经铸出 key，不重复发放。
  if (row.approvedAt) return unknownCode(c)
  return c.json({ status: 'pending' }, 200)
})

export default app
