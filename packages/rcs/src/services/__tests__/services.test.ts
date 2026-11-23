import { beforeEach, describe, expect, test } from 'bun:test'

import { verifyEnvironmentToken } from '@/auth/tokens'
import { toCompatibleCodeSessionId, toWebSessionId } from '@/contracts'
import type { Repositories } from '@/db/repositories/types'
import { createTestRepositories, TEST_USER_IDS } from '@/db/testing'
import {
  deregisterEnvironment,
  listActiveEnvironments,
  reconnectEnvironment,
  registerEnvironment,
  toEnvironmentResponse,
  updatePollTime,
} from '@/services/environment'
import {
  archiveSession,
  authorizeSessionWrite,
  createCodeSession,
  createSession,
  getSession,
  incrementEpoch,
  listSessionsByEnvironment,
  listWebSessionsByOwner,
  reactivateInactiveSession,
  resolveAccessibleSession,
  resolveExistingSessionId,
  resolveOwnedWebSessionId,
  unarchiveSession,
  updateSessionStatus,
  updateSessionTitle,
} from '@/services/session'
import { getAllEventBuses, getEventBus, removeEventBus } from '@/transport/event-bus'

const AUTH_SECRET = 'test-secret'

function resetEventBuses(): void {
  for (const [key] of getAllEventBuses()) {
    removeEventBus(key)
  }
}

async function expectRejects(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let error: unknown
  try {
    await promise
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(Error)
  expect(error instanceof Error ? error.message : '').toMatch(pattern)
}

// ---------- Session Service ----------

describe('Session Service', () => {
  let repos: Repositories

  beforeEach(async () => {
    process.env.RCS_AUTH_SECRET = AUTH_SECRET
    repos = await createTestRepositories({ seedUsers: true })
    resetEventBuses()
  })

  describe('createSession', () => {
    test('creates a session with defaults', async () => {
      const resp = await createSession(repos, {})
      expect(resp.id).toMatch(/^session_/)
      expect(resp.status).toBe('idle')
      expect(resp.source).toBe('remote-control')
      expect(resp.environment_id).toBeNull()
      expect(resp.worker_epoch).toBe(0)
      expect(resp.created_at).toBeGreaterThan(0)
    })

    test('creates a session with all options', async () => {
      const env = await repos.environments.create({ ownerUserId: TEST_USER_IDS.user1 })
      const resp = await createSession(repos, {
        environmentId: env.id,
        ownerUserId: TEST_USER_IDS.user1,
        title: 'My Session',
        source: 'cli',
        permissionMode: 'auto',
      })
      expect(resp.environment_id).toBe(env.id)
      expect(resp.title).toBe('My Session')
      expect(resp.source).toBe('cli')
      expect(resp.permission_mode).toBe('auto')
    })

    test('creates session with owner', async () => {
      const resp = await createSession(repos, { ownerUserId: TEST_USER_IDS.alice })
      expect(resp.owner_user_id).toBe(TEST_USER_IDS.alice)
    })
  })

  describe('createCodeSession', () => {
    test('creates a code session with cse_ prefix', async () => {
      const resp = await createCodeSession(repos, {})
      expect(resp.id).toMatch(/^cse_/)
    })
  })

  describe('getSession', () => {
    test('returns null for non-existent session', async () => {
      expect(await getSession(repos, 'nope')).toBeNull()
    })

    test('returns created session', async () => {
      const created = await createCodeSession(repos, {})
      const fetched = await getSession(repos, created.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.id).toBe(created.id)
    })

    test('resolves a web session id to the canonical code session', async () => {
      const created = await createCodeSession(repos, {})
      const webId = toWebSessionId(created.id)
      const fetched = await getSession(repos, webId)
      expect(fetched?.id).toBe(created.id)
      expect(await resolveExistingSessionId(repos, webId)).toBe(created.id)
    })
  })

  describe('updateSessionTitle', () => {
    test('updates title', async () => {
      const s = await createSession(repos, {})
      await updateSessionTitle(repos, s.id, 'New Title')
      expect((await getSession(repos, s.id))?.title).toBe('New Title')
    })
  })

  describe('updateSessionStatus', () => {
    test('updates status and persists a session_status event', async () => {
      const s = await createCodeSession(repos, {})
      await updateSessionStatus(repos, s.id, 'active')
      expect((await getSession(repos, s.id))?.status).toBe('active')
      const events = await repos.events.listSince(s.id, 0, 10)
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('session_status')
      expect(events[0].payload).toEqual({ status: 'active' })
    })
  })

  describe('reactivateInactiveSession', () => {
    test('revives an inactive session to idle and publishes the status change', async () => {
      const s = await createCodeSession(repos, {})
      await updateSessionStatus(repos, s.id, 'inactive')

      expect(await reactivateInactiveSession(repos, s.id)).toBe('idle')
      expect((await getSession(repos, s.id))?.status).toBe('idle')
      const events = await repos.events.listSince(s.id, 0, 10)
      expect(events.map((event) => event.payload)).toContainEqual({ status: 'idle' })
    })

    test('leaves an archived session terminal', async () => {
      const s = await createCodeSession(repos, {})
      await archiveSession(repos, s.id)

      expect(await reactivateInactiveSession(repos, s.id)).toBe('archived')
      expect((await getSession(repos, s.id))?.status).toBe('archived')
    })

    test('leaves a live session untouched and returns null for unknown ids', async () => {
      const s = await createCodeSession(repos, {})
      await updateSessionStatus(repos, s.id, 'running')

      expect(await reactivateInactiveSession(repos, s.id)).toBe('running')
      expect(await reactivateInactiveSession(repos, 'cse_missing')).toBeNull()
      expect((await getSession(repos, s.id))?.status).toBe('running')
    })
  })

  describe('archiveSession', () => {
    test('sets status to archived and removes event bus', async () => {
      const s = await createCodeSession(repos, {})
      getEventBus(s.id)

      expect(await archiveSession(repos, s.id)).toEqual({ ok: true })
      expect((await getSession(repos, s.id))?.status).toBe('archived')
      expect(getAllEventBuses().has(s.id)).toBe(false)
    })

    test('refuses a session with in-flight work and reports what is running', async () => {
      const s = await createCodeSession(repos, {})
      const env = await repos.environments.create({ id: `env_${crypto.randomUUID()}` })
      const item = await repos.workItems.enqueue({ environmentId: env.id, sessionId: s.id, secret: 's' })
      getEventBus(s.id)

      expect(await archiveSession(repos, s.id)).toEqual({
        ok: false,
        activity: [{ kind: 'work_item', id: item.id, label: 'Queued work item' }],
      })
      // A refused archive must not write the terminal status or tear down the bus.
      expect((await getSession(repos, s.id))?.status).not.toBe('archived')
      expect(getAllEventBuses().has(s.id)).toBe(true)
    })

    test('names a leased work item separately from a queued one', async () => {
      const s = await createCodeSession(repos, {})
      const env = await repos.environments.create({ id: `env_${crypto.randomUUID()}` })
      const item = await repos.workItems.enqueue({ environmentId: env.id, sessionId: s.id, secret: 's' })
      await repos.workItems.claimNext(env.id)

      expect(await archiveSession(repos, s.id)).toEqual({
        ok: false,
        activity: [{ kind: 'work_item', id: item.id, label: 'Leased work item' }],
      })
    })

    test('archives once the in-flight work item has finished', async () => {
      const s = await createCodeSession(repos, {})
      const env = await repos.environments.create({ id: `env_${crypto.randomUUID()}` })
      const item = await repos.workItems.enqueue({ environmentId: env.id, sessionId: s.id, secret: 's' })
      await repos.workItems.setState(item.id, 'completed')

      expect(await archiveSession(repos, s.id)).toEqual({ ok: true })
      expect((await getSession(repos, s.id))?.status).toBe('archived')
    })

    test('archives through in-flight work when stopActivity is requested', async () => {
      const s = await createCodeSession(repos, {})
      const env = await repos.environments.create({ id: `env_${crypto.randomUUID()}` })
      const item = await repos.workItems.enqueue({ environmentId: env.id, sessionId: s.id, secret: 's' })
      getEventBus(s.id)

      expect(await archiveSession(repos, s.id, { stopActivity: true })).toEqual({ ok: true })
      expect((await getSession(repos, s.id))?.status).toBe('archived')
      expect((await repos.workItems.getById(item.id))?.state).toBe('completed')
      expect(getAllEventBuses().has(s.id)).toBe(false)
    })

    test('writes the archived status before publishing the interrupt', async () => {
      const s = await createCodeSession(repos, {})
      const env = await repos.environments.create({ id: `env_${crypto.randomUUID()}` })
      await repos.workItems.enqueue({ environmentId: env.id, sessionId: s.id, secret: 's' })
      getEventBus(s.id)

      await archiveSession(repos, s.id, { stopActivity: true })

      const events = await repos.events.listSince(s.id, 0, 20)
      const status = events.find((event) => event.type === 'session_status')
      const interrupt = events.find((event) => event.type === 'interrupt')
      expect(status?.payload).toEqual({ status: 'archived' })
      // 持久化时会归一化：原始载荷落在 `raw` 下。
      expect(interrupt?.payload).toMatchObject({ raw: { action: 'interrupt' } })
      expect(status?.id).toBeLessThan(interrupt?.id ?? 0)
    })
  })

  describe('unarchiveSession', () => {
    test('restores an archived session to idle and publishes the status change', async () => {
      const s = await createCodeSession(repos, {})
      await archiveSession(repos, s.id)

      await unarchiveSession(repos, s.id)

      expect((await getSession(repos, s.id))?.status).toBe('idle')
      const events = await repos.events.listSince(s.id, 0, 10)
      expect(events.map((event) => event.payload)).toContainEqual({ status: 'idle' })
    })

    test('clears archivedAt set by the repository archive path', async () => {
      const s = await createCodeSession(repos, {})
      await repos.sessions.archive(s.id, new Date())
      expect((await repos.sessions.getById(s.id))?.archivedAt).not.toBeNull()

      await unarchiveSession(repos, s.id)

      const record = await repos.sessions.getById(s.id)
      expect(record?.archivedAt).toBeNull()
      expect(record?.status).toBe('idle')
    })

    test('leaves a live session idle and ignores unknown ids', async () => {
      await unarchiveSession(repos, 'cse_missing')
      const s = await createCodeSession(repos, {})
      await unarchiveSession(repos, s.id)
      expect((await getSession(repos, s.id))?.status).toBe('idle')
    })

    test('makes the session visible in the owner listing again', async () => {
      const s = await createSession(repos, { ownerUserId: TEST_USER_IDS.alice })
      await archiveSession(repos, s.id)
      expect(await listWebSessionsByOwner(repos, { id: TEST_USER_IDS.alice, role: 'member' })).toHaveLength(0)

      await unarchiveSession(repos, s.id)

      expect(
        (await listWebSessionsByOwner(repos, { id: TEST_USER_IDS.alice, role: 'member' })).map((item) => item.id),
      ).toEqual([s.id])
    })
  })

  describe('incrementEpoch', () => {
    test('increments epoch by 1', async () => {
      const s = await createCodeSession(repos, {})
      expect(await incrementEpoch(repos, s.id)).toBe(1)
      expect(await incrementEpoch(repos, s.id)).toBe(2)
      expect((await getSession(repos, s.id))?.worker_epoch).toBe(2)
    })

    test('throws for non-existent session', async () => {
      await expectRejects(incrementEpoch(repos, 'nope'), /session not found/i)
    })
  })

  describe('listWebSessionsByOwner', () => {
    test('filters by owner and maps to web ids', async () => {
      await createSession(repos, { ownerUserId: TEST_USER_IDS.alice })
      await createSession(repos, { ownerUserId: TEST_USER_IDS.bob })
      const sessions = await listWebSessionsByOwner(repos, { id: TEST_USER_IDS.alice, role: 'member' })
      expect(sessions).toHaveLength(1)
      expect(sessions[0].owner_user_id).toBe(TEST_USER_IDS.alice)
      expect(sessions[0].id).toMatch(/^session_/)
    })

    test('skips archived sessions but lists inactive ones so they can be resumed', async () => {
      const archived = await createSession(repos, { ownerUserId: TEST_USER_IDS.alice })
      await updateSessionStatus(repos, archived.id, 'archived')
      const inactive = await createSession(repos, { ownerUserId: TEST_USER_IDS.alice })
      await updateSessionStatus(repos, inactive.id, 'inactive')

      const sessions = await listWebSessionsByOwner(repos, { id: TEST_USER_IDS.alice, role: 'member' })
      expect(sessions.map((session) => session.id)).toEqual([inactive.id])
    })

    test('admins see every owner session', async () => {
      const alice = await repos.users.create({ username: 'alice', passwordHash: 'x', role: 'member' })
      const bob = await repos.users.create({ username: 'bob', passwordHash: 'x', role: 'member' })
      await createSession(repos, { ownerUserId: alice.id })
      await createSession(repos, { ownerUserId: bob.id })
      expect(await listWebSessionsByOwner(repos, { id: 'root', role: 'admin' })).toHaveLength(2)
    })
  })

  describe('resolveOwnedWebSessionId', () => {
    test('returns the canonical id for the owner', async () => {
      const session = await createSession(repos, { ownerUserId: TEST_USER_IDS.alice })
      const resolved = await resolveOwnedWebSessionId(repos, session.id, { id: TEST_USER_IDS.alice, role: 'member' })
      expect(resolved).toBe(toCompatibleCodeSessionId(session.id))
    })

    test('claims an unowned session for the first caller only', async () => {
      const session = await createCodeSession(repos, {})
      const claimed = await resolveOwnedWebSessionId(repos, session.id, { id: TEST_USER_IDS.alice, role: 'member' })
      expect(claimed).toBe(session.id)
      expect(await resolveOwnedWebSessionId(repos, session.id, { id: TEST_USER_IDS.bob, role: 'member' })).toBeNull()
    })

    test('rejects another member session but allows an admin', async () => {
      const session = await createCodeSession(repos, { ownerUserId: TEST_USER_IDS.bob })
      expect(await resolveOwnedWebSessionId(repos, session.id, { id: TEST_USER_IDS.alice, role: 'member' })).toBeNull()
      expect(await resolveOwnedWebSessionId(repos, session.id, { id: 'root', role: 'admin' })).toBe(session.id)
    })
  })

  describe('resolveAccessibleSession', () => {
    test('reports not_found for an unknown session', async () => {
      expect(await resolveAccessibleSession(repos, 'nope', { id: TEST_USER_IDS.alice, role: 'member' })).toEqual({
        ok: false,
        reason: 'not_found',
      })
    })

    test('reports forbidden for another member session', async () => {
      const session = await createCodeSession(repos, { ownerUserId: TEST_USER_IDS.bob })
      expect(await resolveAccessibleSession(repos, session.id, { id: TEST_USER_IDS.alice, role: 'member' })).toEqual({
        ok: false,
        reason: 'forbidden',
      })
    })

    test('returns the canonical id for the owner', async () => {
      const session = await createCodeSession(repos, { ownerUserId: TEST_USER_IDS.alice })
      expect(
        await resolveAccessibleSession(repos, toWebSessionId(session.id), { id: TEST_USER_IDS.alice, role: 'member' }),
      ).toEqual({ ok: true, sessionId: session.id })
    })
  })

  describe('authorizeSessionWrite', () => {
    test('reports the archived status for a closed session', async () => {
      const session = await createSession(repos, { ownerUserId: TEST_USER_IDS.alice })
      await updateSessionStatus(repos, session.id, 'archived')

      expect(await authorizeSessionWrite(repos, session.id, { id: TEST_USER_IDS.alice, role: 'member' })).toEqual({
        ok: false,
        reason: 'closed',
        status: 'archived',
      })
    })

    test('revives an inactive session and returns its canonical id', async () => {
      const session = await createCodeSession(repos, { ownerUserId: TEST_USER_IDS.alice })
      await updateSessionStatus(repos, session.id, 'inactive')

      const access = await authorizeSessionWrite(repos, toWebSessionId(session.id), {
        id: TEST_USER_IDS.alice,
        role: 'member',
      })
      expect(access).toEqual({ ok: true, sessionId: session.id })
      expect((await getSession(repos, session.id))?.status).toBe('idle')
    })

    test('passes through forbidden without touching the session', async () => {
      const session = await createCodeSession(repos, { ownerUserId: TEST_USER_IDS.bob })
      expect(await authorizeSessionWrite(repos, session.id, { id: TEST_USER_IDS.alice, role: 'member' })).toEqual({
        ok: false,
        reason: 'forbidden',
      })
    })
  })

  describe('listSessionsByEnvironment', () => {
    test('filters by environment', async () => {
      const env = await repos.environments.create({ ownerUserId: TEST_USER_IDS.user1 })
      await createSession(repos, { environmentId: env.id })
      await createSession(repos, {})
      const sessions = await listSessionsByEnvironment(repos, env.id)
      expect(sessions).toHaveLength(1)
      expect(sessions[0].environment_id).toBe(env.id)
    })
  })
})

// ---------- Environment Service ----------

describe('Environment Service', () => {
  let repos: Repositories

  beforeEach(async () => {
    process.env.RCS_AUTH_SECRET = AUTH_SECRET
    repos = await createTestRepositories({ seedUsers: true })
  })

  describe('registerEnvironment', () => {
    test('registers environment with defaults', async () => {
      const result = await registerEnvironment(repos, { ownerUserId: TEST_USER_IDS.user1 })
      expect(result.environment_id).toMatch(/^env_/)
      expect(result.environment_secret).toBeTruthy()
      expect(result.status).toBe('active')
      const record = await repos.environments.getById(result.environment_id)
      expect(record?.ownerUserId).toBe(TEST_USER_IDS.user1)
      expect(record?.workerType).toBe('claude_code')
      expect(record?.maxSessions).toBe(1)
    })

    test('returns an environment secret accepted as an environment token', async () => {
      const result = await registerEnvironment(repos, { ownerUserId: TEST_USER_IDS.user1 })
      const verified = await verifyEnvironmentToken(result.environment_secret)
      expect(verified).toEqual({ environmentId: result.environment_id, userId: TEST_USER_IDS.user1 })
    })

    test('registers with options', async () => {
      const result = await registerEnvironment(repos, {
        ownerUserId: TEST_USER_IDS.user1,
        machineName: 'mac1',
        directory: '/home/user',
        branch: 'main',
        gitRepoUrl: 'https://github.com/test/repo',
        maxSessions: 5,
        workerType: 'custom',
      })
      const env = await repos.environments.getById(result.environment_id)
      expect(env?.machineName).toBe('mac1')
      expect(env?.directory).toBe('/home/user')
      expect(env?.branch).toBe('main')
      expect(env?.gitRepoUrl).toBe('https://github.com/test/repo')
      expect(env?.maxSessions).toBe(5)
      expect(env?.workerType).toBe('custom')
    })

    test('reuses a reusable environment id for the same owner', async () => {
      const first = await registerEnvironment(repos, { ownerUserId: TEST_USER_IDS.user1, machineName: 'mac1' })
      const second = await registerEnvironment(repos, {
        environmentId: first.environment_id,
        ownerUserId: TEST_USER_IDS.user1,
        machineName: 'mac2',
      })
      expect(second.environment_id).toBe(first.environment_id)
      const env = await repos.environments.getById(first.environment_id)
      expect(env?.machineName).toBe('mac2')
      expect(await listActiveEnvironments(repos, { isAdmin: true })).toHaveLength(1)
    })

    test('reuses a disconnected environment id instead of creating a new one', async () => {
      const first = await registerEnvironment(repos, { ownerUserId: TEST_USER_IDS.user1 })
      await repos.environments.update(first.environment_id, { status: 'disconnected' })
      const second = await registerEnvironment(repos, {
        environmentId: first.environment_id,
        ownerUserId: TEST_USER_IDS.user1,
      })
      expect(second.environment_id).toBe(first.environment_id)
      expect((await repos.environments.getById(first.environment_id))?.status).toBe('active')
    })

    test('creates a new environment when re-registering with a foreign environment id', async () => {
      const owner = await registerEnvironment(repos, { ownerUserId: TEST_USER_IDS.user1 })
      const intruder = await registerEnvironment(repos, {
        environmentId: owner.environment_id,
        ownerUserId: TEST_USER_IDS.user2,
      })
      expect(intruder.environment_id).not.toBe(owner.environment_id)
      expect((await repos.environments.getById(owner.environment_id))?.ownerUserId).toBe(TEST_USER_IDS.user1)
      expect((await repos.environments.getById(intruder.environment_id))?.ownerUserId).toBe(TEST_USER_IDS.user2)
    })

    test('creates a new environment when re-registering with a stale environment id', async () => {
      const result = await registerEnvironment(repos, {
        environmentId: 'env_missing',
        ownerUserId: TEST_USER_IDS.user1,
      })
      expect(result.environment_id).toMatch(/^env_/)
      expect(result.environment_id).not.toBe('env_missing')
    })

    test('creates and reuses an ACP agent session', async () => {
      const first = await registerEnvironment(repos, {
        ownerUserId: TEST_USER_IDS.user1,
        machineName: 'mac1',
        workerType: 'acp',
      })
      expect(first.session_id).toMatch(/^cse_/)
      const second = await registerEnvironment(repos, {
        environmentId: first.environment_id,
        ownerUserId: TEST_USER_IDS.user1,
        machineName: 'mac1',
        workerType: 'acp',
      })
      expect(second.environment_id).toBe(first.environment_id)
      expect(second.session_id).toBe(first.session_id)
    })

    test('requires an owner', async () => {
      await expectRejects(registerEnvironment(repos, { ownerUserId: '' }), /ownerUserId/i)
    })

    test('maps an environment to the response shape', async () => {
      const result = await registerEnvironment(repos, {
        ownerUserId: TEST_USER_IDS.user1,
        machineName: 'mac1',
        capabilities: { os: 'darwin' },
      })
      const record = await repos.environments.getById(result.environment_id)
      const response = toEnvironmentResponse(record!)
      expect(response.id).toBe(result.environment_id)
      expect(response.machine_name).toBe('mac1')
      expect(response.owner_user_id).toBe(TEST_USER_IDS.user1)
      expect(response.last_poll_at).toBeGreaterThan(0)
      expect(response.channel_group_id).toBeNull()
      expect(response.capabilities).toEqual({ os: 'darwin' })
    })
  })

  describe('deregisterEnvironment', () => {
    test('sets status to deregistered', async () => {
      const result = await registerEnvironment(repos, { ownerUserId: TEST_USER_IDS.user1 })
      await deregisterEnvironment(repos, result.environment_id)
      expect((await repos.environments.getById(result.environment_id))?.status).toBe('deregistered')
    })
  })

  describe('updatePollTime', () => {
    test('updates lastPollAt', async () => {
      const result = await registerEnvironment(repos, { ownerUserId: TEST_USER_IDS.user1 })
      const before = await repos.environments.getById(result.environment_id)
      await updatePollTime(repos, result.environment_id)
      const after = await repos.environments.getById(result.environment_id)
      expect(after?.lastPollAt?.getTime()).toBeGreaterThanOrEqual(before?.lastPollAt?.getTime() ?? 0)
    })

    test('revives a disconnected environment when it polls', async () => {
      const result = await registerEnvironment(repos, { ownerUserId: TEST_USER_IDS.user1 })
      await repos.environments.update(result.environment_id, { status: 'disconnected' })
      await updatePollTime(repos, result.environment_id)
      expect((await repos.environments.getById(result.environment_id))?.status).toBe('active')
    })

    test('does not revive a deregistered environment', async () => {
      const result = await registerEnvironment(repos, { ownerUserId: TEST_USER_IDS.user1 })
      await deregisterEnvironment(repos, result.environment_id)
      await updatePollTime(repos, result.environment_id)
      expect((await repos.environments.getById(result.environment_id))?.status).toBe('deregistered')
    })
  })

  describe('listActiveEnvironments', () => {
    test('returns active environments', async () => {
      await registerEnvironment(repos, { ownerUserId: TEST_USER_IDS.user1 })
      await registerEnvironment(repos, { ownerUserId: TEST_USER_IDS.user2 })
      expect(await listActiveEnvironments(repos, { isAdmin: true })).toHaveLength(2)
    })

    test('filters by owner when not admin', async () => {
      await registerEnvironment(repos, { ownerUserId: TEST_USER_IDS.user1 })
      await registerEnvironment(repos, { ownerUserId: TEST_USER_IDS.user2 })
      expect(await listActiveEnvironments(repos, { ownerUserId: TEST_USER_IDS.user1, isAdmin: false })).toHaveLength(1)
    })

    test('skips deregistered environments', async () => {
      const result = await registerEnvironment(repos, { ownerUserId: TEST_USER_IDS.user1 })
      await deregisterEnvironment(repos, result.environment_id)
      expect(await listActiveEnvironments(repos, { isAdmin: true })).toHaveLength(0)
    })
  })

  describe('reconnectEnvironment', () => {
    test('sets status back to active', async () => {
      const result = await registerEnvironment(repos, { ownerUserId: TEST_USER_IDS.user1 })
      await deregisterEnvironment(repos, result.environment_id)
      expect((await repos.environments.getById(result.environment_id))?.status).toBe('deregistered')
      await reconnectEnvironment(repos, result.environment_id)
      expect((await repos.environments.getById(result.environment_id))?.status).toBe('active')
    })
  })
})
