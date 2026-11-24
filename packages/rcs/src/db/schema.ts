/**
 * Postgres data model (Drizzle).
 *
 * Shared by the gateway (Bun) and the Next server (Node), so this module stays free of
 * runtime-specific imports. IDs are opaque `text` values (`env_…`, `cse_…`, `work_…`)
 * except for users and API keys, which use UUIDs. Timestamps are `timestamptz`.
 */

import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export type Role = 'admin' | 'member'

export type EventDirection = 'inbound' | 'outbound'

/** Raw bytes; postgres-js returns a Buffer and PGlite a Uint8Array. */
const bytea = customType<{ data: Uint8Array }>({
  dataType() {
    return 'bytea'
  },
})

const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Stored lowercase; callers normalize input before insert/lookup. */
  username: text('username').notNull().unique(),
  displayName: text('display_name'),
  passwordHash: text('password_hash').notNull(),
  role: text('role').$type<Role>().notNull().default('member'),
  /** Preferred UI locale; validated at the API boundary, so no DB check constraint. */
  locale: text('locale'),
  disabledAt: timestamp('disabled_at', { withTimezone: true, mode: 'date' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (table) => [index('api_keys_user_id_idx').on(table.userId)],
)

/**
 * 设备码配对（RFC 8628 风格）：CLI 先拿到 `device_code`（只存哈希），用户在 Web 端批准
 * 短码后，token 端点原子占用该行再铸 key。批准本身不落明文，避免 key 留在库里。
 */
export const deviceCodes = pgTable(
  'device_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceCodeHash: text('device_code_hash').notNull().unique(),
    userCode: text('user_code').notNull(),
    clientName: text('client_name'),
    hostname: text('hostname'),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('device_codes_user_code_idx').on(table.userCode)],
)

export const environments = pgTable(
  'environments',
  {
    id: text('id').primaryKey(),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    machineName: text('machine_name'),
    directory: text('directory'),
    branch: text('branch'),
    gitRepoUrl: text('git_repo_url'),
    maxSessions: integer('max_sessions').notNull().default(1),
    workerType: text('worker_type').notNull().default('claude_code'),
    bridgeId: text('bridge_id'),
    capabilities: jsonb('capabilities').$type<Record<string, unknown>>(),
    status: text('status').notNull().default('active'),
    lastPollAt: timestamp('last_poll_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('environments_status_owner_idx').on(table.status, table.ownerUserId)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    environmentId: text('environment_id').references(() => environments.id),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    title: text('title'),
    status: text('status').notNull().default('idle'),
    source: text('source').notNull().default('remote-control'),
    permissionMode: text('permission_mode'),
    workerEpoch: integer('worker_epoch').notNull().default(0),
    /**
     * 最近一次入站 `result` 事件的 seq。未读判定只认"轮次结束"，不看中间事件，
     * 所以改权限模式之类的写入不会把会话标成未读。旧数据为 null，按全部已读处理。
     */
    lastResultSeq: bigint('last_result_seq', { mode: 'number' }),
    /** 最近一次结束的轮次是否失败（`result` 的 subtype 不是 success）。 */
    lastResultFailed: boolean('last_result_failed').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('sessions_owner_status_idx').on(table.ownerUserId, table.status),
    /** Environment scoping: reconnect dispatch and stop paths list sessions by env. */
    index('sessions_environment_id_idx').on(table.environmentId),
  ],
)

export const sessionWorkers = pgTable('session_workers', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  workerStatus: text('worker_status'),
  externalMetadata: jsonb('external_metadata').$type<Record<string, unknown>>(),
  requiresActionDetails: jsonb('requires_action_details').$type<Record<string, unknown>>(),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true, mode: 'date' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/**
 * 账号级的会话阅读记录。列表里的"未读"= 用户没有确认到最近一次轮次结束，
 * 多端共享；已读位置只能单调前进（见 `POST /web/sessions/:id/read`）。
 */
export const sessionReadState = pgTable(
  'session_read_state',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    /** 已确认读到的 `sessions.last_result_seq` 水位。 */
    lastReadSeq: bigint('last_read_seq', { mode: 'number' }).notNull().default(0),
    /** 手动标记的未读；自动确认不会清除它。 */
    manualUnread: boolean('manual_unread').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.sessionId] })],
)

export const workItems = pgTable(
  'work_items',
  {
    id: text('id').primaryKey(),
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    state: text('state').notNull().default('pending'),
    /** Serialized work secret payload. */
    secret: text('secret').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('work_items_environment_state_idx').on(table.environmentId, table.state),
    /**
     * At most one in-flight item per session. Bridge reconnects re-dispatch every idle
     * session, so without this a session can stack pending rows and be launched twice.
     * `enqueue` upserts against this index instead of inserting blindly.
     */
    uniqueIndex('work_items_session_inflight_idx')
      .on(table.sessionId)
      .where(sql`state IN ('pending', 'dispatched')`),
  ],
)

export const sessionEvents = pgTable(
  'session_events',
  {
    /** Globally monotonic id, used as the SSE `Last-Event-ID` / seqNum. */
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventId: uuid('event_id').notNull(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    direction: text('direction').$type<EventDirection>().notNull(),
    /**
     * Message uuid for whole-message events (`user`/`assistant`/`system`/`result`), null
     * for streaming deltas and uuid-less control traffic. The gateway deduplicates bridge
     * writes by this value (the transport contract), so it must be indexed.
     */
    messageUuid: text('message_uuid'),
    createdAt: createdAt(),
  },
  (table) => [
    index('session_events_session_id_idx').on(table.sessionId, table.id),
    /**
     * Durable dedupe key for bridge replays: at most one *inbound* event per message uuid.
     * Partial, because outbound writes deliberately re-emit the same uuid.
     */
    uniqueIndex('session_events_session_message_uuid_idx')
      .on(table.sessionId, table.messageUuid)
      .where(sql`direction = 'inbound' AND message_uuid IS NOT NULL`),
  ],
)

export const attachments = pgTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    mediaType: text('media_type').notNull(),
    /** sha256 hex of `data`; unique per owner so dedupe never crosses accounts. */
    sha256: text('sha256').notNull(),
    byteLength: integer('byte_length').notNull(),
    data: bytea('data').notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('attachments_owner_sha256_idx').on(table.ownerUserId, table.sha256)],
)

export const pushSettings = pgTable('push_settings', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  subject: text('subject').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('push_subscriptions_user_idx').on(table.userId)],
)

/**
 * 交给 services/routes 的记录形状，直接由表定义推导（`$inferSelect`），列名、可空性、
 * 时间/字节类型都不会与写入的接口漂移。`contracts.ts` 以 `export type` 转发这些类型，
 * 业务代码仍从 `@/contracts` 取，运行时不会因此加载 drizzle。
 */
export type UserRecord = typeof users.$inferSelect
export type ApiKeyRecord = typeof apiKeys.$inferSelect
export type DeviceCodeRecord = typeof deviceCodes.$inferSelect
export type EnvironmentRecord = typeof environments.$inferSelect
export type SessionRecord = typeof sessions.$inferSelect
export type SessionWorkerRecord = typeof sessionWorkers.$inferSelect
export type SessionReadStateRecord = typeof sessionReadState.$inferSelect
export type WorkItemRecord = typeof workItems.$inferSelect
export type SessionEventRecord = typeof sessionEvents.$inferSelect
export type AttachmentRecord = typeof attachments.$inferSelect
export type PushSubscriptionRecord = typeof pushSubscriptions.$inferSelect
/** Web Push 配置的发送侧投影，不是整行。 */
export type PushVapidKeys = Pick<typeof pushSettings.$inferSelect, 'publicKey' | 'privateKey' | 'subject'>

export const schema = {
  users,
  apiKeys,
  deviceCodes,
  environments,
  sessions,
  sessionWorkers,
  sessionReadState,
  workItems,
  sessionEvents,
  attachments,
  pushSettings,
  pushSubscriptions,
}
