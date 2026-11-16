import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { Buffer } from 'node:buffer'

import { verifyWorkerToken } from '../../auth/tokens.js'
import { toWebSessionId } from '../../contracts.js'
import { createMemoryRepositories } from '../../db/repositories/index.js'
import type { Repositories } from '../../db/repositories/types.js'
import {
  ackWork,
  createWorkItem,
  heartbeatWork,
  pollWork,
  reconnectWorkForEnvironment,
  stopWork,
} from '../work-dispatch.js'

const AUTH_SECRET = 'test-secret'
const BASE_URL = 'http://localhost:3000'

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

describe('Work Dispatch', () => {
  let repos: Repositories
  let envId: string
  let sessionId: string

  afterAll(() => {
    delete process.env.RCS_BASE_URL
  })

  beforeEach(async () => {
    process.env.RCS_AUTH_SECRET = AUTH_SECRET
    process.env.RCS_BASE_URL = BASE_URL
    repos = createMemoryRepositories()
    const env = await repos.environments.create({ ownerUserId: 'user_1', lastPollAt: new Date() })
    envId = env.id
    const session = await repos.sessions.create({ environmentId: envId })
    sessionId = session.id
  })

  describe('createWorkItem', () => {
    test('creates work item for active environment', async () => {
      const workId = await createWorkItem(repos, envId, sessionId)
      expect(workId).toMatch(/^work_/)
      const item = await repos.workItems.getById(workId)
      expect(item?.state).toBe('pending')
      expect(item?.sessionId).toBe(sessionId)
    })

    test('throws for non-existent environment', async () => {
      await expectRejects(createWorkItem(repos, 'env_no', sessionId), /not found/)
    })

    test('throws for inactive environment', async () => {
      const inactiveEnv = await repos.environments.create({ ownerUserId: 'user_1', status: 'deregistered' })
      await expectRejects(createWorkItem(repos, inactiveEnv.id, sessionId), /not active/)
    })

    test('stores the canonical session id when given a web session id', async () => {
      const webSessionId = toWebSessionId(sessionId)
      const workId = await createWorkItem(repos, envId, webSessionId)
      const item = await repos.workItems.getById(workId)
      expect(item?.sessionId).toBe(sessionId)
      const decoded = JSON.parse(Buffer.from(item!.secret, 'base64url').toString()) as Record<string, unknown>
      expect(await verifyWorkerToken(decoded.session_ingress_token as string)).toEqual({ sessionId })
    })

    test('encodes the legacy work secret shape with a worker token', async () => {
      const workId = await createWorkItem(repos, envId, sessionId)
      const item = await repos.workItems.getById(workId)
      const decoded = JSON.parse(Buffer.from(item!.secret, 'base64url').toString()) as Record<string, unknown>
      expect(decoded.version).toBe(1)
      expect(decoded.api_base_url).toBe(BASE_URL)
      expect(decoded.sources).toEqual([])
      expect(decoded.auth).toEqual([])
      expect(decoded.use_code_sessions).toBe(false)

      const verified = await verifyWorkerToken(decoded.session_ingress_token as string)
      expect(verified).toEqual({ sessionId })
    })
  })

  describe('pollWork', () => {
    test('returns null when no work available (timeout)', async () => {
      const result = await pollWork(repos, envId, 0.1)
      expect(result).toBeNull()
    })

    test('returns pending work and marks as dispatched', async () => {
      const workId = await createWorkItem(repos, envId, sessionId)
      const result = await pollWork(repos, envId, 1)
      expect(result).not.toBeNull()
      expect(result!.id).toBe(workId)
      expect(result!.state).toBe('dispatched')
      expect(result!.data.type).toBe('session')
      expect(result!.data.id).toBe(sessionId)
      expect((await repos.workItems.getById(workId))?.state).toBe('dispatched')
    })

    test('does not return work for a different environment', async () => {
      const env2 = await repos.environments.create({ ownerUserId: 'user_1' })
      await createWorkItem(repos, envId, sessionId)
      const result = await pollWork(repos, env2.id, 0.1)
      expect(result).toBeNull()
    })

    test('wakes a long poller as soon as work is enqueued', async () => {
      const pending = pollWork(repos, envId, 5)
      await new Promise((resolve) => setTimeout(resolve, 20))
      const startedAt = Date.now()
      const workId = await createWorkItem(repos, envId, sessionId)
      const result = await pending
      expect(result?.id).toBe(workId)
      expect(Date.now() - startedAt).toBeLessThan(1000)
    })
  })

  describe('ackWork', () => {
    test('marks work as acked', async () => {
      const workId = await createWorkItem(repos, envId, sessionId)
      await ackWork(repos, workId)
      expect((await repos.workItems.getById(workId))?.state).toBe('acked')
    })
  })

  describe('stopWork', () => {
    test('marks work as completed', async () => {
      const workId = await createWorkItem(repos, envId, sessionId)
      await stopWork(repos, workId)
      expect((await repos.workItems.getById(workId))?.state).toBe('completed')
    })
  })

  describe('heartbeatWork', () => {
    test('extends lease and returns heartbeat info', async () => {
      const workId = await createWorkItem(repos, envId, sessionId)
      const result = await heartbeatWork(repos, workId)
      expect(result.lease_extended).toBe(true)
      expect(result.ttl_seconds).toBe(40)
      expect(result.last_heartbeat).toBeTruthy()
    })

    test('returns default state for non-existent work', async () => {
      const result = await heartbeatWork(repos, 'work_no')
      expect(result.state).toBe('acked')
    })
  })

  describe('reconnectWorkForEnvironment', () => {
    test('creates work items for idle sessions in environment', async () => {
      await repos.sessions.create({ environmentId: envId })
      const workIds = await reconnectWorkForEnvironment(repos, envId)
      expect(workIds).toHaveLength(2)
      for (const id of workIds) {
        expect((await repos.workItems.getById(id))?.state).toBe('pending')
      }
    })

    test('skips non-idle sessions', async () => {
      const activeSession = await repos.sessions.create({ environmentId: envId, status: 'active' })
      expect(activeSession.status).toBe('active')
      const workIds = await reconnectWorkForEnvironment(repos, envId)
      expect(workIds).toHaveLength(1)
    })

    test('returns empty for environment with no sessions', async () => {
      const emptyEnv = await repos.environments.create({ ownerUserId: 'user_1' })
      const workIds = await reconnectWorkForEnvironment(repos, emptyEnv.id)
      expect(workIds).toHaveLength(0)
    })
  })
})
