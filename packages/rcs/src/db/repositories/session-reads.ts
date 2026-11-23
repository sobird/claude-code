/**
 * 账号级会话阅读记录：Postgres（Drizzle）实现。
 *
 * 已读水位只能单调前进；自动确认（acknowledge）不清除手动未读，只有显式的
 * "标记已读"会清除它。列表接口在首次遇到某会话时用 `ensureBaseline` 写入
 * 基线，这样引入本功能之前的历史一律按已读处理。
 */

import { and, eq, inArray, sql } from 'drizzle-orm'

import type { Database } from '@/db/client'
import { sessionReadState } from '@/db/schema'

import type { SessionReadRepository } from './types'

export function createSessionReadRepository(db: Database): SessionReadRepository {
  return {
    async get(userId, sessionId) {
      const [row] = await db
        .select()
        .from(sessionReadState)
        .where(and(eq(sessionReadState.userId, userId), eq(sessionReadState.sessionId, sessionId)))
        .limit(1)
      return row ?? null
    },

    async listByUser(userId, sessionIds) {
      if (sessionIds !== undefined && sessionIds.length === 0) return []
      const where =
        sessionIds === undefined
          ? eq(sessionReadState.userId, userId)
          : and(eq(sessionReadState.userId, userId), inArray(sessionReadState.sessionId, sessionIds))
      return db.select().from(sessionReadState).where(where)
    },

    async ensureBaseline(userId, entries) {
      if (entries.length === 0) return
      const now = new Date()
      await db
        .insert(sessionReadState)
        .values(
          entries.map((entry) => ({
            userId,
            sessionId: entry.sessionId,
            lastReadSeq: entry.lastResultSeq ?? 0,
            manualUnread: false,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoNothing()
    },

    async acknowledge(userId, sessionId, throughSeq) {
      const now = new Date()
      // 并发确认用 GREATEST 单调推进；自动确认不触碰 manual_unread。
      await db
        .insert(sessionReadState)
        .values({ userId, sessionId, lastReadSeq: throughSeq, manualUnread: false, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [sessionReadState.userId, sessionReadState.sessionId],
          set: {
            lastReadSeq: sql`greatest(${sessionReadState.lastReadSeq}, ${throughSeq})`,
            updatedAt: now,
          },
        })
    },

    async markRead(userId, sessionId, throughSeq) {
      const now = new Date()
      await db
        .insert(sessionReadState)
        .values({ userId, sessionId, lastReadSeq: throughSeq, manualUnread: false, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [sessionReadState.userId, sessionReadState.sessionId],
          set: {
            lastReadSeq: sql`greatest(${sessionReadState.lastReadSeq}, ${throughSeq})`,
            manualUnread: false,
            updatedAt: now,
          },
        })
    },

    async markUnread(userId, sessionId) {
      const now = new Date()
      await db
        .insert(sessionReadState)
        .values({ userId, sessionId, lastReadSeq: 0, manualUnread: true, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [sessionReadState.userId, sessionReadState.sessionId],
          set: { manualUnread: true, updatedAt: now },
        })
    },
  }
}
