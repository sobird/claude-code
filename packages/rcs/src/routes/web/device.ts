/**
 * Web 端设备码批准：登录用户预览机器信息并批准一次配对。
 *
 * 批准只记 `approved_by_user_id`，不铸 key；明文 key 由公开的 token 端点在被领取时
 * 生成并只返回一次。找不到待批准行时区分「未知」与「已过期」，供页面给出准确文案。
 */

import { Hono } from 'hono'
import type { Context } from 'hono'

import type { AppEnv } from '@/auth/context'
import type { DeviceCodeRecord } from '@/contracts'
import type { Repositories } from '@/db/repositories/types'
import { legacyUserAuth, readJson, webNotFound } from '@/routes/common'

const app = new Hono<AppEnv>()

/** 归一化用户输入：忽略大小写、连字符和空白。 */
function normalizeUserCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** 与 token 端点铸 key 时的命名保持一致。 */
function displayName(row: DeviceCodeRecord): string {
  return `dsh @ ${row.hostname || row.clientName || 'machine'}`
}

/** 没有待批准行时区分「未知」与「已过期」；已批准/已消费一律按未知处理。 */
async function rejectionCode(repos: Repositories, code: string): Promise<string> {
  const row = await repos.deviceCodes.findByUserCode(code)
  if (row && row.expiresAt.getTime() <= Date.now()) return 'device_code_expired'
  return 'device_code_not_found'
}

function rejection(c: Context<AppEnv>, code: string) {
  return code === 'device_code_expired'
    ? webNotFound(c, 'Pairing code expired', code)
    : webNotFound(c, 'Pairing code not found', code)
}

/** GET /web/auth/device/:userCode — 预览待批准的机器信息。 */
app.get('/auth/device/:userCode', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const code = normalizeUserCode(c.req.param('userCode'))

  const row = await repos.deviceCodes.findPendingByUserCode(code)
  if (!row) return rejection(c, await rejectionCode(repos, code))

  return c.json(
    {
      client: row.clientName,
      hostname: row.hostname,
      expires_at: Math.floor(row.expiresAt.getTime() / 1000),
      status: 'pending',
    },
    200,
  )
})

/** POST /web/auth/device/approve — 批准一次配对（重复批准无效）。 */
app.post('/auth/device/approve', legacyUserAuth, async (c) => {
  const repos = c.get('repos')
  const user = c.get('user')

  const body = await readJson(c)
  const code = normalizeUserCode(typeof body.user_code === 'string' ? body.user_code : '')

  const row = await repos.deviceCodes.approve(code, user.id)
  if (!row) return rejection(c, await rejectionCode(repos, code))

  return c.json({ ok: true, name: displayName(row) }, 200)
})

export default app
