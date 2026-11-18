/**
 * Session service.
 *
 * Sessions are stored with canonical `cse_…` ids. Helpers accept either the canonical
 * id or the web-facing `session_…` form and resolve to the stored row. Ownership is
 * enforced here (admins bypass), with atomic claiming of legacy unowned sessions.
 */

import {
  isSessionClosedStatus,
  type Role,
  type SessionRecord,
  toCompatibleCodeSessionId,
  toWebSessionId,
} from '../contracts.js'
import type { Repositories, SessionListOptions } from '../db/repositories/types.js'
import { getAllEventBuses, removeEventBus } from '../transport/event-bus.js'

export interface ServiceUser {
  id: string
  role: Role
}

export interface NewSessionInput {
  environmentId?: string | null
  ownerUserId?: string | null
  title?: string | null
  source?: string
  permissionMode?: string | null
}

export interface SessionResponse {
  id: string
  environment_id: string | null
  title: string | null
  status: string
  source: string
  permission_mode: string | null
  worker_epoch: number
  owner_user_id: string | null
  created_at: number
  updated_at: number
}

export function toSessionResponse(row: SessionRecord): SessionResponse {
  return {
    id: row.id,
    environment_id: row.environmentId,
    title: row.title,
    status: row.status,
    source: row.source,
    permission_mode: row.permissionMode,
    worker_epoch: row.workerEpoch,
    owner_user_id: row.ownerUserId,
    created_at: row.createdAt.getTime() / 1000,
    updated_at: row.updatedAt.getTime() / 1000,
  }
}

export function toWebSessionResponse(session: SessionResponse): SessionResponse {
  return { ...session, id: toWebSessionId(session.id) }
}

/** Look up a session by canonical or compatible web id. */
async function findSession(repos: Repositories, sessionId: string): Promise<SessionRecord | null> {
  const direct = await repos.sessions.getById(sessionId)
  if (direct) return direct

  const compatibleId = toCompatibleCodeSessionId(sessionId)
  if (compatibleId) return repos.sessions.getById(compatibleId)

  return null
}

async function resolveSessionId(repos: Repositories, sessionId: string): Promise<string | null> {
  const record = await findSession(repos, sessionId)
  return record?.id ?? null
}

async function createRecord(repos: Repositories, input: NewSessionInput): Promise<SessionRecord> {
  return repos.sessions.create({
    environmentId: input.environmentId ?? null,
    ownerUserId: input.ownerUserId ?? null,
    title: input.title ?? null,
    source: input.source ?? 'remote-control',
    permissionMode: input.permissionMode ?? null,
  })
}

/** Web/remote-control session creation; the response carries the `session_…` id. */
export async function createSession(repos: Repositories, input: NewSessionInput): Promise<SessionResponse> {
  const record = await createRecord(repos, input)
  return toWebSessionResponse(toSessionResponse(record))
}

/** Code-session creation (`cse_…`); the response carries the canonical id. */
export async function createCodeSession(repos: Repositories, input: NewSessionInput): Promise<SessionResponse> {
  const record = await createRecord(repos, input)
  return toSessionResponse(record)
}

export async function getSession(repos: Repositories, sessionId: string): Promise<SessionResponse | null> {
  const record = await findSession(repos, sessionId)
  return record ? toSessionResponse(record) : null
}

export async function resolveExistingSessionId(repos: Repositories, sessionId: string): Promise<string | null> {
  return resolveSessionId(repos, sessionId)
}

/** Backwards-compatible alias for web-session resolution. */
export async function resolveExistingWebSessionId(repos: Repositories, sessionId: string): Promise<string | null> {
  return resolveSessionId(repos, sessionId)
}

/**
 * Resolve a session the user may access. Admins may access any session. Members may
 * access their own; an unowned session is atomically claimed by the first caller.
 */
export async function resolveOwnedWebSessionId(
  repos: Repositories,
  sessionId: string,
  user: ServiceUser,
): Promise<string | null> {
  const record = await findSession(repos, sessionId)
  if (!record) return null
  if (user.role === 'admin' || record.ownerUserId === user.id) return record.id
  if (record.ownerUserId === null) {
    const claimed = await repos.sessions.claimUnowned(record.id, user.id)
    return claimed ? record.id : null
  }
  return null
}

/** Web-facing sessions for a user; admins see every owner's sessions. */
export async function listWebSessionsByOwner(repos: Repositories, user: ServiceUser): Promise<SessionResponse[]> {
  const records = user.role === 'admin' ? await listAllSessions(repos) : await repos.sessions.listByOwner(user.id)
  return records
    .filter((record) => !isSessionClosedStatus(record.status))
    .map(toSessionResponse)
    .map(toWebSessionResponse)
}

export async function listSessionsByEnvironment(
  repos: Repositories,
  environmentId: string,
): Promise<SessionResponse[]> {
  const records = await repos.sessions.listByEnvironment(environmentId)
  return records.map(toSessionResponse)
}

/**
 * Every session visible through repositories. There is no list-all query, so this
 * unions the unowned set with each user's owned set. Used by the disconnect monitor.
 */
export async function listAllSessions(repos: Repositories, options?: SessionListOptions): Promise<SessionRecord[]> {
  const byId = new Map<string, SessionRecord>()
  for (const record of await repos.sessions.listUnowned(options)) {
    byId.set(record.id, record)
  }
  for (const user of await repos.users.list()) {
    for (const record of await repos.sessions.listByOwner(user.id, options)) {
      byId.set(record.id, record)
    }
  }
  return [...byId.values()].toSorted(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  )
}

export async function updateSessionTitle(repos: Repositories, sessionId: string, title: string): Promise<void> {
  const canonicalId = await resolveSessionId(repos, sessionId)
  if (!canonicalId) return
  await repos.sessions.update(canonicalId, { title })
}

/**
 * Update the session status, persist a `session_status` event, and notify any live
 * subscriber. The bus is only touched when one already exists so status sweeps do not
 * create buses for idle sessions.
 */
export async function updateSessionStatus(repos: Repositories, sessionId: string, status: string): Promise<void> {
  const canonicalId = await resolveSessionId(repos, sessionId)
  if (!canonicalId) return

  await repos.sessions.update(canonicalId, { status })
  const persisted = await repos.events.append({
    sessionId: canonicalId,
    type: 'session_status',
    payload: { status },
    direction: 'inbound',
  })

  const bus = getAllEventBuses().get(canonicalId)
  bus?.publish({
    id: persisted.eventId,
    sessionId: canonicalId,
    type: 'session_status',
    payload: { status },
    direction: 'inbound',
    seqNum: persisted.id,
    createdAt: persisted.createdAt.getTime(),
  })
}

/**
 * Resume a session the disconnect monitor marked `inactive` when the user opens or writes
 * to it. Archiving is a deliberate owner action and stays terminal. Returns the resulting
 * status, or `null` when the session does not exist.
 */
export async function reactivateInactiveSession(repos: Repositories, sessionId: string): Promise<string | null> {
  const record = await findSession(repos, sessionId)
  if (!record) return null
  if (record.status !== 'inactive') return record.status
  await updateSessionStatus(repos, record.id, 'idle')
  return 'idle'
}

export async function archiveSession(repos: Repositories, sessionId: string): Promise<void> {
  const canonicalId = await resolveSessionId(repos, sessionId)
  if (!canonicalId) return
  await updateSessionStatus(repos, canonicalId, 'archived')
  removeEventBus(canonicalId)
}

/**
 * Restore an archived session to `idle`. Archiving is terminal for the disconnect
 * monitor (`reactivateInactiveSession` refuses it), so only this explicit action
 * clears it, including the `archivedAt` column set by repository-level archives.
 */
export async function unarchiveSession(repos: Repositories, sessionId: string): Promise<void> {
  const record = await findSession(repos, sessionId)
  if (!record) return
  if (record.archivedAt !== null) await repos.sessions.update(record.id, { archivedAt: null })
  await updateSessionStatus(repos, record.id, 'idle')
}

export async function incrementEpoch(repos: Repositories, sessionId: string): Promise<number> {
  const canonicalId = await resolveSessionId(repos, sessionId)
  if (!canonicalId) throw new Error('Session not found')
  return repos.sessions.incrementEpoch(canonicalId)
}
