/**
 * Runtime-neutral record contracts shared by the gateway, repositories, and services.
 *
 * Keep this module free of Bun/Node-specific imports so Next and the gateway can both
 * consume it. Timestamps are `Date` instances in camelCase, mirroring the DB columns.
 */

/**
 * 记录形状由 `src/db/schema.ts` 的表定义推导（`$inferSelect`），这里只做类型转发，
 * 避免手写接口与表定义漂移。`export type` 在编译期擦除，运行时不会加载 drizzle。
 */
export type {
  ApiKeyRecord,
  AttachmentRecord,
  DeviceCodeRecord,
  EnvironmentRecord,
  PushSubscriptionRecord,
  PushVapidKeys,
  Role,
  SessionEventRecord,
  SessionReadStateRecord,
  SessionRecord,
  SessionWorkerRecord,
  UserRecord,
  WorkItemRecord,
} from '@/db/schema'

const CODE_SESSION_PREFIX = 'cse_'
const WEB_SESSION_PREFIX = 'session_'
/**
 * Statuses that make a session terminal. `inactive` is deliberately excluded: it is a
 * liveness signal set by the disconnect monitor, and a user can resume such a session
 * (see `reactivateInactiveSession`). Only an explicit archive is final, and it must pass
 * the activity guard first (in-flight work item, live bridge, pending control request).
 */
const CLOSED_SESSION_STATUSES = new Set(['archived'])

export function toWebSessionId(sessionId: string): string {
  if (!sessionId.startsWith(CODE_SESSION_PREFIX)) return sessionId
  return `${WEB_SESSION_PREFIX}${sessionId.slice(CODE_SESSION_PREFIX.length)}`
}

export function toCompatibleCodeSessionId(sessionId: string): string | null {
  if (!sessionId.startsWith(WEB_SESSION_PREFIX)) return null
  return `${CODE_SESSION_PREFIX}${sessionId.slice(WEB_SESSION_PREFIX.length)}`
}

export function isSessionClosedStatus(status: string | null | undefined): boolean {
  return !!status && CLOSED_SESSION_STATUSES.has(status)
}
