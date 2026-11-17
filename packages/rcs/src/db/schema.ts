/**
 * Postgres data model (Drizzle).
 *
 * Shared by the gateway (Bun) and the Next server (Node), so this module stays free of
 * runtime-specific imports. IDs are opaque `text` values (`env_…`, `cse_…`, `work_…`)
 * except for users and API keys, which use UUIDs. Timestamps are `timestamptz`.
 */

import { sql } from 'drizzle-orm'
import { bigserial, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import type { Role } from '../contracts'

export type EventDirection = 'inbound' | 'outbound'

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

export const schema = {
  users,
  apiKeys,
  environments,
  sessions,
  sessionWorkers,
  workItems,
  sessionEvents,
}
