/**
 * 会话列表的展示排序：纯函数，便于单测。
 *
 * 优先级照搬 dsh 的思路：等你处理 > 有新结果 > 运行中 > 其余。awaiting 与 unread
 * 是两种独立信号，awaiting 压过 unread（阻塞中的会话本来也还没被确认）。
 */

import type { SessionSummary } from './types'

export type SessionFace = 'awaiting' | 'unread' | 'running' | 'idle'

const FACE_RANK: Record<SessionFace, number> = {
  awaiting: 0,
  unread: 1,
  running: 2,
  idle: 3,
}

export function sessionFace(session: SessionSummary): SessionFace {
  if (session.awaiting) return 'awaiting'
  if (session.unread) return 'unread'
  if (session.status === 'running') return 'running'
  return 'idle'
}

/** 稳定排序：同档按 `updated_at` 倒序（服务端时间，秒）。 */
export function compareSessions(left: SessionSummary, right: SessionSummary): number {
  const byFace = FACE_RANK[sessionFace(left)] - FACE_RANK[sessionFace(right)]
  if (byFace !== 0) return byFace
  return (right.updated_at || 0) - (left.updated_at || 0)
}

export function sortSessions<T extends SessionSummary>(sessions: readonly T[]): T[] {
  return sessions.toSorted(compareSessions)
}

/**
 * 角标用的计数：与 `sessionFace` 同一口径，awaiting 优先于 unread，
 * 所以两者互斥，合计就是"需要你处理"的会话数。
 */
export function sessionCounts(sessions: readonly SessionSummary[]): { awaiting: number; unread: number } {
  let awaiting = 0
  let unread = 0
  for (const session of sessions) {
    const face = sessionFace(session)
    if (face === 'awaiting') awaiting += 1
    else if (face === 'unread') unread += 1
  }
  return { awaiting, unread }
}

/** 拆出"需要你处理"分组，其余保持原顺序。 */
export function splitAwaiting<T extends SessionSummary>(
  sessions: readonly T[],
): {
  awaiting: T[]
  rest: T[]
} {
  const awaiting: T[] = []
  const rest: T[] = []
  for (const session of sessions) {
    if (session.awaiting) awaiting.push(session)
    else rest.push(session)
  }
  return { awaiting, rest }
}
