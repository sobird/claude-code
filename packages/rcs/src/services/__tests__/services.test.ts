import { beforeEach, describe, expect, test } from 'bun:test'

import { verifyEnvironmentToken } from '../../auth/tokens.js'
import { toCompatibleCodeSessionId, toWebSessionId } from '../../contracts.js'
import { createMemoryRepositories } from '../../db/repositories/index.js'
import type { Repositories } from '../../db/repositories/types.js'
import {
  getAllEventBuses,
  getEventBus,
  normalizePayload,
  publishSessionEvent,
  removeEventBus,
} from '../../transport/event-bus.js'
import {
  deregisterEnvironment,
  listActiveEnvironments,
  reconnectEnvironment,
  registerEnvironment,
  toEnvironmentResponse,
  updatePollTime,
} from '../environment.js'
import {
  archiveSession,
  createCodeSession,
  createSession,
  getSession,
  incrementEpoch,
  listSessionsByEnvironment,
  listWebSessionsByOwner,
  resolveExistingSessionId,
  resolveOwnedWebSessionId,
  updateSessionStatus,
  updateSessionTitle,
} from '../session.js'

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

  beforeEach(() => {
    process.env.RCS_AUTH_SECRET = AUTH_SECRET
    repos = createMemoryRepositories()
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
      const env = await repos.environments.create({ ownerUserId: 'user_1' })
      const resp = await createSession(repos, {
        environmentId: env.id,
        ownerUserId: 'user_1',
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
      const resp = await createSession(repos, { ownerUserId: 'alice' })
      expect(resp.owner_user_id).toBe('alice')
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

  describe('archiveSession', () => {
    test('sets status to archived and removes event bus', async () => {
      const s = await createCodeSession(repos, {})
      getEventBus(s.id)
      await archiveSession(repos, s.id)
      expect((await getSession(repos, s.id))?.status).toBe('archived')
      expect(getAllEventBuses().has(s.id)).toBe(false)
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
      await createSession(repos, { ownerUserId: 'alice' })
      await createSession(repos, { ownerUserId: 'bob' })
      const sessions = await listWebSessionsByOwner(repos, { id: 'alice', role: 'member' })
      expect(sessions).toHaveLength(1)
      expect(sessions[0].owner_user_id).toBe('alice')
      expect(sessions[0].id).toMatch(/^session_/)
    })

    test('skips closed sessions', async () => {
      const session = await createSession(repos, { ownerUserId: 'alice' })
      await updateSessionStatus(repos, session.id, 'archived')
      expect(await listWebSessionsByOwner(repos, { id: 'alice', role: 'member' })).toHaveLength(0)
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
      const session = await createSession(repos, { ownerUserId: 'alice' })
      const resolved = await resolveOwnedWebSessionId(repos, session.id, { id: 'alice', role: 'member' })
      expect(resolved).toBe(toCompatibleCodeSessionId(session.id))
    })

    test('claims an unowned session for the first caller only', async () => {
      const session = await createCodeSession(repos, {})
      const claimed = await resolveOwnedWebSessionId(repos, session.id, { id: 'alice', role: 'member' })
      expect(claimed).toBe(session.id)
      expect(await resolveOwnedWebSessionId(repos, session.id, { id: 'bob', role: 'member' })).toBeNull()
    })

    test('rejects another member session but allows an admin', async () => {
      const session = await createCodeSession(repos, { ownerUserId: 'bob' })
      expect(await resolveOwnedWebSessionId(repos, session.id, { id: 'alice', role: 'member' })).toBeNull()
      expect(await resolveOwnedWebSessionId(repos, session.id, { id: 'root', role: 'admin' })).toBe(session.id)
    })
  })

  describe('listSessionsByEnvironment', () => {
    test('filters by environment', async () => {
      const env = await repos.environments.create({ ownerUserId: 'user_1' })
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

  beforeEach(() => {
    process.env.RCS_AUTH_SECRET = AUTH_SECRET
    repos = createMemoryRepositories()
  })

  describe('registerEnvironment', () => {
    test('registers environment with defaults', async () => {
      const result = await registerEnvironment(repos, { ownerUserId: 'user_1' })
      expect(result.environment_id).toMatch(/^env_/)
      expect(result.environment_secret).toBeTruthy()
      expect(result.status).toBe('active')
      const record = await repos.environments.getById(result.environment_id)
      expect(record?.ownerUserId).toBe('user_1')
      expect(record?.workerType).toBe('claude_code')
      expect(record?.maxSessions).toBe(1)
    })

    test('returns an environment secret accepted as an environment token', async () => {
      const result = await registerEnvironment(repos, { ownerUserId: 'user_1' })
      const verified = await verifyEnvironmentToken(result.environment_secret)
      expect(verified).toEqual({ environmentId: result.environment_id, userId: 'user_1' })
    })

    test('registers with options', async () => {
      const result = await registerEnvironment(repos, {
        ownerUserId: 'user_1',
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
      const first = await registerEnvironment(repos, { ownerUserId: 'user_1', machineName: 'mac1' })
      const second = await registerEnvironment(repos, {
        environmentId: first.environment_id,
        ownerUserId: 'user_1',
        machineName: 'mac2',
      })
      expect(second.environment_id).toBe(first.environment_id)
      const env = await repos.environments.getById(first.environment_id)
      expect(env?.machineName).toBe('mac2')
      expect(await listActiveEnvironments(repos, { isAdmin: true })).toHaveLength(1)
    })

    test('creates a new environment when re-registering with a foreign environment id', async () => {
      const owner = await registerEnvironment(repos, { ownerUserId: 'user_1' })
      const intruder = await registerEnvironment(repos, {
        environmentId: owner.environment_id,
        ownerUserId: 'user_2',
      })
      expect(intruder.environment_id).not.toBe(owner.environment_id)
      expect((await repos.environments.getById(owner.environment_id))?.ownerUserId).toBe('user_1')
      expect((await repos.environments.getById(intruder.environment_id))?.ownerUserId).toBe('user_2')
    })

    test('creates a new environment when re-registering with a stale environment id', async () => {
      const result = await registerEnvironment(repos, { environmentId: 'env_missing', ownerUserId: 'user_1' })
      expect(result.environment_id).toMatch(/^env_/)
      expect(result.environment_id).not.toBe('env_missing')
    })

    test('creates and reuses an ACP agent session', async () => {
      const first = await registerEnvironment(repos, { ownerUserId: 'user_1', machineName: 'mac1', workerType: 'acp' })
      expect(first.session_id).toMatch(/^cse_/)
      const second = await registerEnvironment(repos, {
        environmentId: first.environment_id,
        ownerUserId: 'user_1',
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
        ownerUserId: 'user_1',
        machineName: 'mac1',
        capabilities: { os: 'darwin' },
      })
      const record = await repos.environments.getById(result.environment_id)
      const response = toEnvironmentResponse(record!)
      expect(response.id).toBe(result.environment_id)
      expect(response.machine_name).toBe('mac1')
      expect(response.owner_user_id).toBe('user_1')
      expect(response.last_poll_at).toBeGreaterThan(0)
      expect(response.channel_group_id).toBeNull()
      expect(response.capabilities).toEqual({ os: 'darwin' })
    })
  })

  describe('deregisterEnvironment', () => {
    test('sets status to deregistered', async () => {
      const result = await registerEnvironment(repos, { ownerUserId: 'user_1' })
      await deregisterEnvironment(repos, result.environment_id)
      expect((await repos.environments.getById(result.environment_id))?.status).toBe('deregistered')
    })
  })

  describe('updatePollTime', () => {
    test('updates lastPollAt', async () => {
      const result = await registerEnvironment(repos, { ownerUserId: 'user_1' })
      const before = await repos.environments.getById(result.environment_id)
      await updatePollTime(repos, result.environment_id)
      const after = await repos.environments.getById(result.environment_id)
      expect(after?.lastPollAt?.getTime()).toBeGreaterThanOrEqual(before?.lastPollAt?.getTime() ?? 0)
    })
  })

  describe('listActiveEnvironments', () => {
    test('returns active environments', async () => {
      await registerEnvironment(repos, { ownerUserId: 'user_1' })
      await registerEnvironment(repos, { ownerUserId: 'user_2' })
      expect(await listActiveEnvironments(repos, { isAdmin: true })).toHaveLength(2)
    })

    test('filters by owner when not admin', async () => {
      await registerEnvironment(repos, { ownerUserId: 'user_1' })
      await registerEnvironment(repos, { ownerUserId: 'user_2' })
      expect(await listActiveEnvironments(repos, { ownerUserId: 'user_1', isAdmin: false })).toHaveLength(1)
    })

    test('skips deregistered environments', async () => {
      const result = await registerEnvironment(repos, { ownerUserId: 'user_1' })
      await deregisterEnvironment(repos, result.environment_id)
      expect(await listActiveEnvironments(repos, { isAdmin: true })).toHaveLength(0)
    })
  })

  describe('reconnectEnvironment', () => {
    test('sets status back to active', async () => {
      const result = await registerEnvironment(repos, { ownerUserId: 'user_1' })
      await deregisterEnvironment(repos, result.environment_id)
      expect((await repos.environments.getById(result.environment_id))?.status).toBe('deregistered')
      await reconnectEnvironment(repos, result.environment_id)
      expect((await repos.environments.getById(result.environment_id))?.status).toBe('active')
    })
  })
})

// ---------- Transport Service (payload normalization + event publication) ----------

describe('Transport Service', () => {
  let repos: Repositories

  beforeEach(() => {
    process.env.RCS_AUTH_SECRET = AUTH_SECRET
    repos = createMemoryRepositories()
    resetEventBuses()
  })

  describe('normalizePayload', () => {
    test('handles string payload', () => {
      const result = normalizePayload('user', 'hello world')
      expect(result.content).toBe('hello world')
      expect(result.raw).toBe('hello world')
    })

    test('handles null payload', () => {
      const result = normalizePayload('user', null)
      expect(result.content).toBe('')
      expect(result.raw).toBeNull()
    })

    test('handles object with direct content', () => {
      const result = normalizePayload('user', { content: 'direct text' })
      expect(result.content).toBe('direct text')
    })

    test('handles object with message.content string', () => {
      const result = normalizePayload('assistant', { message: { role: 'assistant', content: 'reply' } })
      expect(result.content).toBe('reply')
    })

    test('handles object with message.content array', () => {
      const result = normalizePayload('assistant', {
        message: {
          content: [
            { type: 'text', text: 'hello ' },
            { type: 'text', text: 'world' },
          ],
        },
      })
      expect(result.content).toBe('hello world')
    })

    test('preserves tool fields', () => {
      const result = normalizePayload('tool_use', { tool_name: 'Bash', tool_input: { cmd: 'ls' } })
      expect(result.tool_name).toBe('Bash')
      expect(result.tool_input).toEqual({ cmd: 'ls' })
    })

    test('preserves permission fields', () => {
      const result = normalizePayload('permission', {
        request_id: 'req_1',
        approved: true,
        updated_input: { cmd: 'ls -la' },
      })
      expect(result.request_id).toBe('req_1')
      expect(result.approved).toBe(true)
      expect(result.updated_input).toEqual({ cmd: 'ls -la' })
    })

    test('preserves message field', () => {
      const msg = { role: 'user', content: 'hi' }
      const result = normalizePayload('user', { message: msg })
      expect(result.message).toEqual(msg)
    })

    test('preserves uuid field', () => {
      const result = normalizePayload('user', { uuid: 'msg_123', content: 'hi' })
      expect(result.uuid).toBe('msg_123')
    })

    test('preserves isSynthetic field', () => {
      const result = normalizePayload('user', { content: 'scheduled job: refresh analytics cache', isSynthetic: true })
      expect(result.isSynthetic).toBe(true)
    })

    test('uses name as tool_name fallback', () => {
      const result = normalizePayload('tool', { name: 'Read' })
      expect(result.tool_name).toBe('Read')
    })

    test('uses input as tool_input fallback', () => {
      const result = normalizePayload('tool', { input: { path: '/tmp' } })
      expect(result.tool_input).toEqual({ path: '/tmp' })
    })

    test('handles empty content array', () => {
      const result = normalizePayload('assistant', { message: { content: [] } })
      expect(result.content).toBe('')
    })

    test('preserves task_state fields', () => {
      const result = normalizePayload('task_state', {
        task_list_id: 'team-alpha',
        tasks: [{ id: '1', subject: 'Task 1', status: 'pending' }],
      })
      expect(result.task_list_id).toBe('team-alpha')
      expect(result.tasks).toEqual([{ id: '1', subject: 'Task 1', status: 'pending' }])
    })

    test('preserves status metadata for conversation reset events', () => {
      const result = normalizePayload('status', {
        status: 'conversation_cleared',
        subtype: 'status',
        message: 'conversation_cleared',
      })
      expect(result.status).toBe('conversation_cleared')
      expect(result.subtype).toBe('status')
      expect(result.message).toBe('conversation_cleared')
    })

    test('handles undefined payload', () => {
      const result = normalizePayload('user', undefined)
      expect(result.content).toBe('')
    })
  })

  describe('publishSessionEvent', () => {
    test('persists and publishes an event to the session bus', async () => {
      const bus = getEventBus('s1')
      const received: unknown[] = []
      bus.subscribe((event) => received.push(event))

      const event = await publishSessionEvent(repos, bus, 's1', 'user', { content: 'hello' }, 'outbound')
      expect(event.type).toBe('user')
      expect(event.direction).toBe('outbound')
      expect(event.sessionId).toBe('s1')
      expect(event.seqNum).toBe(1)
      expect(received).toHaveLength(1)

      const persisted = await repos.events.listSince('s1', 0, 10)
      expect(persisted).toHaveLength(1)
      expect(persisted[0].type).toBe('user')
    })

    test('normalizes payload before persisting and publishing', async () => {
      const event = await publishSessionEvent(
        repos,
        getEventBus('s1'),
        's1',
        'assistant',
        { message: { content: 'reply' } },
        'inbound',
      )
      const payload = event.payload as Record<string, unknown>
      expect(payload.content).toBe('reply')
    })
  })
})
