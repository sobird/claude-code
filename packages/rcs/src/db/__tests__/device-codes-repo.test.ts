import { afterAll, describe, expect, test } from 'bun:test'

import { createPgliteDatabase, runMigrations } from '@/db/client'
import { createRepositories } from '@/db/repositories'
import type { Repositories } from '@/db/repositories'

const ctx = await createPgliteDatabase()
await runMigrations(ctx.db)
afterAll(() => ctx.close())

const repos: Repositories = createRepositories(ctx.db)

/** 每次测试用唯一 hash / user_code，PGlite 共享同一个库。 */
let counter = 0
function unique(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

const HOUR = 60 * 60 * 1000

function future(offsetMs = HOUR): Date {
  return new Date(Date.now() + offsetMs)
}

describe('DeviceCodeRepository (PGlite)', () => {
  test('create stores the row and findPendingByUserCode returns it', async () => {
    const hash = unique('hash')
    const code = unique('CODE')
    const created = await repos.deviceCodes.create({
      deviceCodeHash: hash,
      userCode: code,
      clientName: 'dsh-rcs-plugin',
      hostname: 'macbook',
      expiresAt: future(),
    })

    expect(created.deviceCodeHash).toBe(hash)
    expect(created.userCode).toBe(code)
    expect(created.clientName).toBe('dsh-rcs-plugin')
    expect(created.hostname).toBe('macbook')
    expect(created.approvedByUserId).toBeNull()
    expect(created.approvedAt).toBeNull()
    expect(created.consumedAt).toBeNull()
    expect(created.createdAt).toBeInstanceOf(Date)

    expect((await repos.deviceCodes.findPendingByUserCode(code))?.id).toBe(created.id)
  })

  test('approve records the user once and only while pending', async () => {
    const user = await repos.users.create({ username: unique('device-user'), passwordHash: 'x', role: 'member' })
    const code = unique('APPROVE')
    await repos.deviceCodes.create({
      deviceCodeHash: unique('hash'),
      userCode: code,
      clientName: null,
      hostname: null,
      expiresAt: future(),
    })

    const approved = await repos.deviceCodes.approve(code, user.id)
    expect(approved?.approvedByUserId).toBe(user.id)
    expect(approved?.approvedAt).toBeInstanceOf(Date)

    // 已批准的行不再接受第二次批准（换人或重复点击都无效）。
    expect(await repos.deviceCodes.approve(code, user.id)).toBeNull()
  })

  test('approve returns null for unknown or expired codes', async () => {
    const user = await repos.users.create({ username: unique('device-user'), passwordHash: 'x', role: 'member' })
    expect(await repos.deviceCodes.approve(unique('missing'), user.id)).toBeNull()

    const code = unique('EXPIRED')
    await repos.deviceCodes.create({
      deviceCodeHash: unique('hash'),
      userCode: code,
      clientName: null,
      hostname: null,
      expiresAt: new Date(Date.now() - 1000),
    })
    expect(await repos.deviceCodes.approve(code, user.id)).toBeNull()
  })

  test('claim fails before approval and records consumption only once', async () => {
    const user = await repos.users.create({ username: unique('device-user'), passwordHash: 'x', role: 'member' })
    const hash = unique('hash')
    const code = unique('CLAIM')
    await repos.deviceCodes.create({
      deviceCodeHash: hash,
      userCode: code,
      clientName: null,
      hostname: null,
      expiresAt: future(),
    })

    expect(await repos.deviceCodes.claim(hash)).toBeNull()

    await repos.deviceCodes.approve(code, user.id)
    const claimed = await repos.deviceCodes.claim(hash)
    expect(claimed?.approvedByUserId).toBe(user.id)
    expect(claimed?.consumedAt).toBeInstanceOf(Date)
    expect(await repos.deviceCodes.claim(hash)).toBeNull()
  })

  test('claim returns null for expired rows', async () => {
    const user = await repos.users.create({ username: unique('device-user'), passwordHash: 'x', role: 'member' })
    const hash = unique('hash')
    const code = unique('LATECLAIM')
    await repos.deviceCodes.create({
      deviceCodeHash: hash,
      userCode: code,
      clientName: null,
      hostname: null,
      expiresAt: future(),
    })
    await repos.deviceCodes.approve(code, user.id)

    expect(await repos.deviceCodes.claim(hash, new Date(Date.now() + 2 * HOUR))).toBeNull()
  })

  test('expired rows disappear from pending lookup', async () => {
    const code = unique('PENDING')
    await repos.deviceCodes.create({
      deviceCodeHash: unique('hash'),
      userCode: code,
      clientName: null,
      hostname: null,
      expiresAt: future(1000),
    })

    expect(await repos.deviceCodes.findPendingByUserCode(code, new Date(Date.now() + 2 * HOUR))).toBeNull()
  })

  test('findByDeviceCodeHash reports approval and consumption state', async () => {
    const user = await repos.users.create({ username: unique('device-user'), passwordHash: 'x', role: 'member' })
    const hash = unique('hash')
    const code = unique('BYSASH')
    await repos.deviceCodes.create({
      deviceCodeHash: hash,
      userCode: code,
      clientName: null,
      hostname: null,
      expiresAt: future(),
    })

    const pending = await repos.deviceCodes.findByDeviceCodeHash(hash)
    expect(pending?.approvedAt).toBeNull()
    expect(await repos.deviceCodes.findByDeviceCodeHash(unique('missing'))).toBeNull()

    await repos.deviceCodes.approve(code, user.id)
    expect((await repos.deviceCodes.findByDeviceCodeHash(hash))?.approvedByUserId).toBe(user.id)

    await repos.deviceCodes.claim(hash)
    expect((await repos.deviceCodes.findByDeviceCodeHash(hash))?.consumedAt).toBeInstanceOf(Date)
  })

  test('deleteExpiredBefore only removes rows older than the threshold', async () => {
    const keep = unique('KEEP')
    const drop = unique('DROP')
    await repos.deviceCodes.create({
      deviceCodeHash: unique('hash'),
      userCode: keep,
      clientName: null,
      hostname: null,
      expiresAt: future(HOUR),
    })
    await repos.deviceCodes.create({
      deviceCodeHash: unique('hash'),
      userCode: drop,
      clientName: null,
      hostname: null,
      expiresAt: new Date(Date.now() - 2 * HOUR),
    })

    await repos.deviceCodes.deleteExpiredBefore(new Date(Date.now() - HOUR))

    expect(await repos.deviceCodes.findPendingByUserCode(keep)).not.toBeNull()
    expect(await repos.deviceCodes.findPendingByUserCode(drop)).toBeNull()
  })
})
