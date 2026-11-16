/**
 * Repository interfaces for users, API keys, environments, and sessions.
 *
 * Repositories are the only place that touches the database; consumers (services,
 * routes) depend on these interfaces so tests can swap in the in-memory
 * implementations.
 */

import type { ApiKeyRecord, EnvironmentRecord, Role, SessionRecord, UserRecord } from '../../contracts.js'

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

export interface UserRepository {
  create(input: CreateUserInput): Promise<UserRecord>
  getById(id: string): Promise<UserRecord | null>
  getByUsername(username: string): Promise<UserRecord | null>
  count(): Promise<number>
  list(): Promise<UserRecord[]>
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

export interface EnvironmentRepository {
  create(input: CreateEnvironmentInput): Promise<EnvironmentRecord>
  getById(id: string): Promise<EnvironmentRecord | null>
  update(id: string, patch: EnvironmentPatch): Promise<void>
  /** Active environments; scoped to `ownerUserId` when supplied. */
  listActive(options?: ListActiveEnvironmentsOptions): Promise<EnvironmentRecord[]>
  /** Active environment owned by `ownerUserId`, or `null` (never another user's). */
  findReusable(input: FindReusableEnvironmentInput): Promise<EnvironmentRecord | null>
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

/** Partial composition; Task 7 extends this with the remaining repositories. */
export interface Repositories {
  users: UserRepository
  apiKeys: ApiKeyRepository
  environments: EnvironmentRepository
  sessions: SessionRepository
}
