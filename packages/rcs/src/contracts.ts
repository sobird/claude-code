/**
 * Runtime-neutral record contracts shared by the gateway, repositories, and services.
 *
 * Keep this module free of Bun/Node-specific imports so Next and the gateway can both
 * consume it. Timestamps are `Date` instances in camelCase, mirroring the DB columns.
 */

export type Role = 'admin' | 'member'

export interface UserRecord {
  id: string
  /** Stored normalized to lowercase. */
  username: string
  displayName: string | null
  passwordHash: string
  role: Role
  disabledAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ApiKeyRecord {
  id: string
  userId: string
  name: string
  tokenPrefix: string
  tokenHash: string
  lastUsedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}

export interface EnvironmentRecord {
  id: string
  ownerUserId: string | null
  machineName: string | null
  directory: string | null
  branch: string | null
  gitRepoUrl: string | null
  maxSessions: number
  workerType: string
  bridgeId: string | null
  capabilities: Record<string, unknown> | null
  status: string
  lastPollAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface SessionRecord {
  id: string
  environmentId: string | null
  ownerUserId: string | null
  title: string | null
  status: string
  source: string
  permissionMode: string | null
  workerEpoch: number
  createdAt: Date
  updatedAt: Date
  archivedAt: Date | null
}

export interface SessionWorkerRecord {
  sessionId: string
  workerStatus: string | null
  externalMetadata: Record<string, unknown> | null
  requiresActionDetails: Record<string, unknown> | null
  lastHeartbeatAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface WorkItemRecord {
  id: string
  environmentId: string
  sessionId: string
  state: string
  secret: string
  createdAt: Date
  updatedAt: Date
}

export interface SessionEventRecord {
  /** Globally monotonic bigserial id, used as the SSE `Last-Event-ID` / seqNum. */
  id: number
  eventId: string
  sessionId: string
  type: string
  payload: unknown
  direction: 'inbound' | 'outbound'
  createdAt: Date
}

const CODE_SESSION_PREFIX = 'cse_'
const WEB_SESSION_PREFIX = 'session_'
const CLOSED_SESSION_STATUSES = new Set(['archived', 'inactive'])

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
