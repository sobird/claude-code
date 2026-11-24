/**
 * 设备码仓储：只存 device_code 的哈希与短码，批准记用户，领取时原子落 `consumed_at`。
 *
 * 条件更新把「状态机」交给数据库：`approve` / `claim` 都要求行仍 pending 且未过期，
 * 并发调用最多一个成功，避免同一配对铸出两把 key。
 */

import { and, desc, eq, gt, isNotNull, isNull, lt } from 'drizzle-orm'

import type { Database } from '@/db/client'
import { deviceCodes } from '@/db/schema'

import type { DeviceCodeRepository } from './types'

export function createDeviceCodeRepository(db: Database): DeviceCodeRepository {
  return {
    async create(input) {
      const [row] = await db
        .insert(deviceCodes)
        .values({
          deviceCodeHash: input.deviceCodeHash,
          userCode: input.userCode,
          clientName: input.clientName,
          hostname: input.hostname,
          expiresAt: input.expiresAt,
        })
        .returning()
      return row
    },

    async findPendingByUserCode(userCode, now = new Date()) {
      const [row] = await db
        .select()
        .from(deviceCodes)
        .where(and(eq(deviceCodes.userCode, userCode), isNull(deviceCodes.consumedAt), gt(deviceCodes.expiresAt, now)))
        .limit(1)
      return row ?? null
    },

    async findByDeviceCodeHash(deviceCodeHash) {
      const [row] = await db.select().from(deviceCodes).where(eq(deviceCodes.deviceCodeHash, deviceCodeHash)).limit(1)
      return row ?? null
    },

    async findByUserCode(userCode) {
      // 短码理论上可能重复，取最新的一行，避免旧行遮挡本次配对。
      const [row] = await db
        .select()
        .from(deviceCodes)
        .where(eq(deviceCodes.userCode, userCode))
        .orderBy(desc(deviceCodes.createdAt))
        .limit(1)
      return row ?? null
    },

    async approve(userCode, userId, now = new Date()) {
      const [row] = await db
        .update(deviceCodes)
        .set({ approvedByUserId: userId, approvedAt: now })
        .where(
          and(
            eq(deviceCodes.userCode, userCode),
            isNull(deviceCodes.approvedAt),
            isNull(deviceCodes.consumedAt),
            gt(deviceCodes.expiresAt, now),
          ),
        )
        .returning()
      return row ?? null
    },

    async claim(deviceCodeHash, now = new Date()) {
      const [row] = await db
        .update(deviceCodes)
        .set({ consumedAt: now })
        .where(
          and(
            eq(deviceCodes.deviceCodeHash, deviceCodeHash),
            isNotNull(deviceCodes.approvedAt),
            isNull(deviceCodes.consumedAt),
            gt(deviceCodes.expiresAt, now),
          ),
        )
        .returning()
      return row ?? null
    },

    async deleteExpiredBefore(before) {
      await db.delete(deviceCodes).where(lt(deviceCodes.expiresAt, before))
    },
  }
}
