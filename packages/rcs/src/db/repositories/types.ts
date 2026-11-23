/**
 * Repository interfaces for users, API keys, environments, sessions, work items,
 * session workers, and durable session events.
 *
 * Repositories are the only place that touches the database; consumers (services,
 * routes) depend on these interfaces so tests can swap in the in-memory
 * implementations.
 */

import type {
  ApiKeyRecord,
  AttachmentRecord,
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
} from '@/contracts'

export interface CreateUserInput {
  username: string
  displayName?: string
  passwordHash: string
  role: Role
}

export interface CreateApiKeyInput {
  userId: string
  name: string
  /** Display prefix of the raw key (`rcs_…`); stored as `tokenPrefix`. */
  prefix: string
  /** sha256 hex of the raw key; stored as `tokenHash`. */
  hash: string
}

/** Mutable profile columns; credentials use the dedicated setters. */
export interface UserPatch {
  role?: Role
  displayName?: string | null
  locale?: string | null
}

/** Atomic last-admin guard input; `disabledAt: undefined` leaves the flag unchanged. */
export interface GuardedUserPatch extends UserPatch {
  /** A `Date` disables the user, `null` re-enables them. */
  disabledAt?: Date | null
}

export type GuardedUserUpdateResult = { updated: true } | { updated: false; reason: 'not_found' | 'last_admin' }

export interface UserRepository {
  create(input: CreateUserInput): Promise<UserRecord>
  getById(id: string): Promise<UserRecord | null>
  getByUsername(username: string): Promise<UserRecord | null>
  count(): Promise<number>
  list(): Promise<UserRecord[]>
  /** Update mutable profile columns. */
  update(id: string, patch: UserPatch): Promise<void>
  /**
   * Apply `patch` while refusing to demote or disable the last enabled admin.
   * Implementations serialize concurrent calls (Postgres locks the enabled admin
   * rows) so two requests cannot both observe another admin.
   */
  updateGuarded(id: string, patch: GuardedUserPatch): Promise<GuardedUserUpdateResult>
  /** Disable the user (`disabledAt` set) or re-enable them (`null`). */
  setDisabled(id: string, disabledAt: Date | null): Promise<void>
  setPasswordHash(id: string, hash: string): Promise<void>
}

export interface ApiKeyRepository {
  create(input: CreateApiKeyInput): Promise<ApiKeyRecord>
  /** Look up by token hash; returns revoked keys too so callers can reject them. */
  getByHash(hash: string): Promise<ApiKeyRecord | null>
  /** Record successful use. */
  touch(id: string): Promise<void>
  revoke(id: string, at: Date): Promise<void>
  /** All keys owned by the user, including revoked ones (the UI filters display). */
  listByUser(userId: string): Promise<ApiKeyRecord[]>
}

export interface CreateEnvironmentInput {
  /** Explicit `env_…` id; generated when omitted. */
  id?: string
  ownerUserId?: string | null
  machineName?: string | null
  directory?: string | null
  branch?: string | null
  gitRepoUrl?: string | null
  maxSessions?: number
  workerType?: string
  bridgeId?: string | null
  capabilities?: Record<string, unknown> | null
  status?: string
  lastPollAt?: Date | null
}

/** Mutable environment columns; `id`/`createdAt`/`updatedAt` are managed by the repo. */
export type EnvironmentPatch = Partial<Omit<EnvironmentRecord, 'id' | 'createdAt' | 'updatedAt'>>

export interface FindReusableEnvironmentInput {
  environmentId: string
  ownerUserId: string
}

export interface ListActiveEnvironmentsOptions {
  ownerUserId?: string
}

export interface ListByWorkerTypeOptions {
  ownerUserId?: string
}

export interface EnvironmentRepository {
  create(input: CreateEnvironmentInput): Promise<EnvironmentRecord>
  getById(id: string): Promise<EnvironmentRecord | null>
  update(id: string, patch: EnvironmentPatch): Promise<void>
  /** Active environments; scoped to `ownerUserId` when supplied. */
  listActive(options?: ListActiveEnvironmentsOptions): Promise<EnvironmentRecord[]>
  /**
   * Environments a user should still see in the UI — `active`, `disconnected`, and
   * `offline`. The reaper flips a quiet worker to a liveness status without the
   * environment going away, so listing only `active` makes rows flicker out and back.
   * `deregistered` is a deliberate owner action and stays hidden. Scoped to `ownerUserId`
   * when supplied.
   */
  listVisible(options?: ListActiveEnvironmentsOptions): Promise<EnvironmentRecord[]>
  /** Active environment owned by `ownerUserId`, or `null` (never another user's). */
  findReusable(input: FindReusableEnvironmentInput): Promise<EnvironmentRecord | null>
  /**
   * Every environment of a worker type regardless of status (online and offline ACP
   * agents), ascending by `createdAt`; scoped to `ownerUserId` when supplied.
   */
  listByWorkerType(workerType: string, options?: ListByWorkerTypeOptions): Promise<EnvironmentRecord[]>
}

export interface CreateSessionInput {
  /** Explicit `cse_…` id; generated when omitted. */
  id?: string
  environmentId?: string | null
  ownerUserId?: string | null
  title?: string | null
  status?: string
  source?: string
  permissionMode?: string | null
}

/** Mutable session columns; `id`/`createdAt`/`updatedAt` are managed by the repo. */
export type SessionPatch = Partial<Omit<SessionRecord, 'id' | 'createdAt' | 'updatedAt'>>

export interface SessionListOptions {
  /** Include rows with `archivedAt` set; default `false`. */
  includeArchived?: boolean
}

export interface SessionRepository {
  create(input: CreateSessionInput): Promise<SessionRecord>
  getById(id: string): Promise<SessionRecord | null>
  listByOwner(userId: string, options?: SessionListOptions): Promise<SessionRecord[]>
  listByEnvironment(environmentId: string, options?: SessionListOptions): Promise<SessionRecord[]>
  listUnowned(options?: SessionListOptions): Promise<SessionRecord[]>
  update(id: string, patch: SessionPatch): Promise<void>
  /** Atomically increments `worker_epoch` and returns the new value. */
  incrementEpoch(id: string): Promise<number>
  /** Atomically claims a session only while it has no owner; `true` when this call won. */
  claimUnowned(sessionId: string, userId: string): Promise<boolean>
  /** Marks the session archived (`archivedAt` + `status: 'archived'`). */
  archive(id: string, at: Date): Promise<void>
}

export interface CreatePushSubscriptionInput {
  endpoint: string
  p256dh: string
  auth: string
  userAgent?: string | null
}

export interface PushSubscriptionRepository {
  /** Insert or update the row for this endpoint, reassigning it to `userId`. */
  upsertForUser(userId: string, input: CreatePushSubscriptionInput): Promise<PushSubscriptionRecord>
  /** Newest first. */
  listByUser(userId: string): Promise<PushSubscriptionRecord[]>
  deleteById(id: string): Promise<void>
  deleteByEndpoint(userId: string, endpoint: string): Promise<void>
}

export interface PushSettingsRepository {
  get(): Promise<PushVapidKeys | null>
  /** Upsert the single row (`id = 'default'`). */
  set(keys: PushVapidKeys): Promise<void>
}

/** Every repository module, composed by `createRepositories`. */
export interface Repositories {
  users: UserRepository
  apiKeys: ApiKeyRepository
  environments: EnvironmentRepository
  sessions: SessionRepository
  workItems: WorkItemRepository
  sessionWorkers: SessionWorkerRepository
  sessionReads: SessionReadRepository
  events: EventRepository
  attachments: AttachmentRepository
  pushSubscriptions: PushSubscriptionRepository
  pushSettings: PushSettingsRepository
}

export interface CreateAttachmentInput {
  ownerUserId: string
  mediaType: string
  /** sha256 hex of `data`, computed by the upload route. */
  sha256: string
  byteLength: number
  data: Uint8Array
}

export interface AttachmentRepository {
  /**
   * Stores the bytes and returns the row; when the owner already has a row with the
   * same hash it is returned instead (the unique `(owner, sha256)` index arbitrates
   * concurrent uploads).
   */
  createOrGet(input: CreateAttachmentInput): Promise<AttachmentRecord>
  getById(id: string): Promise<AttachmentRecord | null>
}

export interface EnqueueWorkItemInput {
  environmentId: string
  sessionId: string
  /** Serialized work secret payload (`work_items.secret` is `text`). */
  secret: string
}

export interface ClaimNextOptions {
  /**
   * Lease reclaim window. When positive, `dispatched` items whose `updatedAt` is older than
   * this many milliseconds are returned to `pending` before the claim, so work the worker
   * never acknowledged (stale `session_ingress_token`, failed ack) is delivered again.
   * Omitted or non-positive disables reclaim.
   */
  reclaimOlderThanMs?: number
}

export interface WorkItemRepository {
  /** Creates a `pending` work item with a generated `work_…` id. */
  enqueue(input: EnqueueWorkItemInput): Promise<WorkItemRecord>
  /**
   * Atomically claims the oldest pending item for the environment and marks it
   * `dispatched`; returns `null` when there is nothing to claim. With
   * `reclaimOlderThanMs`, stale dispatched items are first put back to `pending`.
   */
  claimNext(environmentId: string, options?: ClaimNextOptions): Promise<WorkItemRecord | null>
  getById(id: string): Promise<WorkItemRecord | null>
  /** The session's in-flight (`pending`/`dispatched`) item, or null when it has none. */
  getInflightBySession(sessionId: string): Promise<WorkItemRecord | null>
  /** Transition the item's state (`pending`/`dispatched`/`acked`/`completed`). */
  setState(id: string, state: string): Promise<void>
  /** Heartbeat / lease extension: bumps `updatedAt` without changing state. */
  bump(id: string): Promise<void>
}

export interface SessionWorkerPatch {
  workerStatus?: string | null
  /** Object patches merge into the stored value; `null` clears it. */
  externalMetadata?: Record<string, unknown> | null
  requiresActionDetails?: Record<string, unknown> | null
  lastHeartbeatAt?: Date | null
}

export interface SessionWorkerRepository {
  get(sessionId: string): Promise<SessionWorkerRecord | null>
  /** 批量读取 worker 行，供列表接口一次拿到 `requires_action_details`。 */
  listBySessionIds(sessionIds: readonly string[]): Promise<SessionWorkerRecord[]>
  /** Insert when missing, otherwise merge the patch and bump `updatedAt`. */
  upsert(sessionId: string, patch: SessionWorkerPatch): Promise<SessionWorkerRecord>
}

/** 首次见到的会话按当前水位建立"已读"基线。 */
export interface SessionReadBaseline {
  sessionId: string
  lastResultSeq: number | null
}

export interface SessionReadRepository {
  get(userId: string, sessionId: string): Promise<SessionReadStateRecord | null>
  /** 某用户的阅读记录；传入 `sessionIds` 时只取这些会话。 */
  listByUser(userId: string, sessionIds?: readonly string[]): Promise<SessionReadStateRecord[]>
  /** 为还没有记录行的会话写入已读基线；已有行不受影响。 */
  ensureBaseline(userId: string, entries: readonly SessionReadBaseline[]): Promise<void>
  /** 自动确认：只单调推进已读水位，不清除手动未读。 */
  acknowledge(userId: string, sessionId: string, throughSeq: number): Promise<void>
  /** 显式标记已读：推进水位并清除手动未读。 */
  markRead(userId: string, sessionId: string, throughSeq: number): Promise<void>
  /** 显式标记未读。 */
  markUnread(userId: string, sessionId: string): Promise<void>
}

export interface AppendEventInput {
  sessionId: string
  type: string
  payload: unknown
  direction: SessionEventRecord['direction']
  /**
   * Set only for whole-message events whose uuid identifies the message. Streaming
   * deltas leave it null so they are never mistaken for a replayed message.
   */
  messageUuid?: string | null
}

export interface EventRepository {
  /** Persists an event and returns the inserted row (including its `bigserial` id). */
  append(input: AppendEventInput): Promise<SessionEventRecord>
  /**
   * Persists an inbound event unless an inbound row with the same `(session_id, message_uuid)`
   * already exists; returns `null` when the write lost to the durable unique key. This is the
   * atomic dedupe that closes the read-then-insert race in `hasMessageUuid` (concurrent
   * bridge replays / HTTP writers), which otherwise duplicate `tool_use` messages and wedge
   * the next model request. Outbound rewrites are never deduplicated.
   */
  appendIfAbsent(input: AppendEventInput): Promise<SessionEventRecord | null>
  /**
   * Events with `id > afterId`, ascending (SSE `Last-Event-ID` replay). `direction` filters
   * inside the query so `limit` counts matching rows — a dense backlog of the other
   * direction must not crowd the replay window.
   */
  listSince(
    sessionId: string,
    afterId: number,
    limit: number,
    direction?: SessionEventRecord['direction'],
  ): Promise<SessionEventRecord[]>
  /** Events with `id < beforeId`, newest-first window returned in display order. */
  listBefore(
    sessionId: string,
    beforeId: number,
    limit: number,
    direction?: SessionEventRecord['direction'],
  ): Promise<SessionEventRecord[]>
  /** Highest event id for the session, or `null` when it has no events. */
  latestId(sessionId: string): Promise<number | null>
  /** `created_at` of the newest event, or `null` when it has none. Session activity signal. */
  latestCreatedAt(sessionId: string): Promise<Date | null>
  /** True when a whole-message event with this uuid is already persisted for the session. */
  hasMessageUuid(sessionId: string, uuid: string): Promise<boolean>
}
