/**
 * Repository interfaces for users and API keys.
 *
 * Repositories are the only place that touches the database; consumers (services,
 * routes) depend on these interfaces so tests can swap in the in-memory
 * implementations.
 */

import type { ApiKeyRecord, Role, UserRecord } from '../../contracts.js'

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

/** Partial composition; later tasks extend this with the remaining repositories. */
export interface Repositories {
  users: UserRepository
  apiKeys: ApiKeyRepository
}
