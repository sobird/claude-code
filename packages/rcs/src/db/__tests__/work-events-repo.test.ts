import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPgliteDatabase, runMigrations } from '../client.js'
import { createMemoryRepositories, createRepositories } from '../repositories/index.js'
import type { Repositories } from '../repositories/index.js'

const ctx = await createPgliteDatabase()
await runMigrations(ctx.db)
afterAll(() => ctx.close())

/**
 * Both implementations must satisfy the same assertions. The Postgres half shares one
 * migrated PGlite database (each test uses unique environment/session ids, so queries
 * stay scoped); the memory half gets a fresh empty store per test.
 */
function repositorySuite(name: string, makeRepos: () => Repositories): void {
  describe(name, () => {
    let repos: Repositories

    beforeEach(() => {
      repos = makeRepos()
    })

    async function makeEnvironmentAndSession(): Promise<{ environmentId: string; sessionId: string }> {
      const tag = crypto.randomUUID()
      const env = await repos.environments.create({ id: `env_${tag}` })
      const session = await repos.sessions.create({ id: `cse_${tag}`, environmentId: env.id })
      return { environmentId: env.id, sessionId: session.id }
    }

    test('enqueue stores a pending work item and returns the secret unchanged', async () => {
      const { environmentId, sessionId } = await makeEnvironmentAndSession()
      const item = await repos.workItems.enqueue({ environmentId, sessionId, secret: 'secret-payload' })

      expect(item.id.startsWith('work_')).toBe(true)
      expect(item.environmentId).toBe(environmentId)
      expect(item.sessionId).toBe(sessionId)
      expect(item.state).toBe('pending')
      expect(item.secret).toBe('secret-payload')
      expect(item.createdAt).toBeInstanceOf(Date)
      expect(item.updatedAt).toBeInstanceOf(Date)
      expect((await repos.workItems.getById(item.id))?.id).toBe(item.id)
    })

    test('getById returns null for unknown work items', async () => {
      expect(await repos.workItems.getById('work_missing')).toBeNull()
    })

    test('claimNext dispatches the oldest pending item for the environment only', async () => {
      const target = await makeEnvironmentAndSession()
      const other = await makeEnvironmentAndSession()
      const first = await repos.workItems.enqueue({
        environmentId: target.environmentId,
        sessionId: target.sessionId,
        secret: 'first',
      })
      // Space the rows out so `created_at` strictly orders them (ids are random UUIDs).
      await Bun.sleep(5)
      await repos.workItems.enqueue({
        environmentId: target.environmentId,
        sessionId: target.sessionId,
        secret: 'second',
      })
      await repos.workItems.enqueue({
        environmentId: other.environmentId,
        sessionId: other.sessionId,
        secret: 'foreign',
      })

      const claimed = await repos.workItems.claimNext(target.environmentId)
      expect(claimed?.id).toBe(first.id)
      expect(claimed?.state).toBe('dispatched')
      expect((await repos.workItems.getById(first.id))?.state).toBe('dispatched')

      const next = await repos.workItems.claimNext(target.environmentId)
      expect(next?.secret).toBe('second')

      expect(await repos.workItems.claimNext(target.environmentId)).toBeNull()
    })

    test('claimNext returns null when the environment has no pending work', async () => {
      expect(await repos.workItems.claimNext('env_without_work')).toBeNull()
    })

    test('concurrent claims deliver an item once', async () => {
      const { environmentId, sessionId } = await makeEnvironmentAndSession()
      await repos.workItems.enqueue({ environmentId, sessionId, secret: 'only' })

      const [a, b] = await Promise.all([
        repos.workItems.claimNext(environmentId),
        repos.workItems.claimNext(environmentId),
      ])
      const claimed = [a, b].filter((item) => item !== null)

      expect(claimed).toHaveLength(1)
      expect(claimed[0]?.state).toBe('dispatched')
    })

    test('setState transitions state and bump refreshes updatedAt', async () => {
      const { environmentId, sessionId } = await makeEnvironmentAndSession()
      const item = await repos.workItems.enqueue({ environmentId, sessionId, secret: 's' })

      await repos.workItems.setState(item.id, 'acked')
      const acked = await repos.workItems.getById(item.id)
      expect(acked?.state).toBe('acked')

      await repos.workItems.bump(item.id)
      const bumped = await repos.workItems.getById(item.id)
      expect(bumped?.state).toBe('acked')
      expect(bumped?.updatedAt.getTime()).toBeGreaterThanOrEqual(acked?.updatedAt.getTime() ?? 0)

      await repos.workItems.setState(item.id, 'completed')
      expect((await repos.workItems.getById(item.id))?.state).toBe('completed')
    })

    test('session worker upsert creates, then merges patches', async () => {
      const { sessionId } = await makeEnvironmentAndSession()

      expect(await repos.sessionWorkers.get(sessionId)).toBeNull()

      const heartbeat = new Date('2026-05-06T07:08:09.000Z')
      const created = await repos.sessionWorkers.upsert(sessionId, {
        workerStatus: 'starting',
        externalMetadata: { machine: 'box', pid: 1 },
        requiresActionDetails: { reason: 'auth' },
        lastHeartbeatAt: heartbeat,
      })

      expect(created.sessionId).toBe(sessionId)
      expect(created.workerStatus).toBe('starting')
      expect(created.externalMetadata).toEqual({ machine: 'box', pid: 1 })
      expect(created.requiresActionDetails).toEqual({ reason: 'auth' })
      expect(created.lastHeartbeatAt?.getTime()).toBe(heartbeat.getTime())
      expect(created.createdAt).toBeInstanceOf(Date)

      const merged = await repos.sessionWorkers.upsert(sessionId, {
        workerStatus: 'running',
        externalMetadata: { pid: 2 },
      })

      expect(merged.workerStatus).toBe('running')
      expect(merged.externalMetadata).toEqual({ machine: 'box', pid: 2 })
      expect(merged.requiresActionDetails).toEqual({ reason: 'auth' })
      expect(merged.createdAt.getTime()).toBe(created.createdAt.getTime())
      expect(merged.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime())
      expect((await repos.sessionWorkers.get(sessionId))?.workerStatus).toBe('running')
    })

    test('session worker upsert can clear nullable fields', async () => {
      const { sessionId } = await makeEnvironmentAndSession()
      await repos.sessionWorkers.upsert(sessionId, {
        workerStatus: 'running',
        externalMetadata: { pid: 1 },
      })

      const cleared = await repos.sessionWorkers.upsert(sessionId, {
        workerStatus: null,
        externalMetadata: null,
        requiresActionDetails: null,
        lastHeartbeatAt: null,
      })

      expect(cleared.workerStatus).toBeNull()
      expect(cleared.externalMetadata).toBeNull()
      expect(cleared.requiresActionDetails).toBeNull()
      expect(cleared.lastHeartbeatAt).toBeNull()
    })

    test('events append returns an ascending bigserial id and a generated eventId', async () => {
      const { sessionId } = await makeEnvironmentAndSession()
      const first = await repos.events.append({
        sessionId,
        type: 'user',
        payload: { text: 'hi' },
        direction: 'inbound',
      })
      const second = await repos.events.append({ sessionId, type: 'assistant', payload: {}, direction: 'outbound' })

      expect(first.id).toBeGreaterThan(0)
      expect(second.id).toBeGreaterThan(first.id)
      expect(first.eventId).not.toBe(second.eventId)
      expect(first.sessionId).toBe(sessionId)
      expect(first.type).toBe('user')
      expect(first.payload).toEqual({ text: 'hi' })
      expect(first.direction).toBe('inbound')
      expect(first.createdAt).toBeInstanceOf(Date)
    })

    test('listSince is exclusive and ordered', async () => {
      const { sessionId } = await makeEnvironmentAndSession()
      const first = await repos.events.append({ sessionId, type: 'user', payload: {}, direction: 'inbound' })
      const second = await repos.events.append({ sessionId, type: 'assistant', payload: {}, direction: 'inbound' })
      const third = await repos.events.append({ sessionId, type: 'system', payload: {}, direction: 'inbound' })

      const rows = await repos.events.listSince(sessionId, first.id, 100)
      expect(rows.map((row) => row.id)).toEqual([second.id, third.id])

      const limited = await repos.events.listSince(sessionId, first.id, 1)
      expect(limited.map((row) => row.id)).toEqual([second.id])

      expect(await repos.events.listSince(sessionId, third.id, 100)).toEqual([])
    })

    test('listSince only returns events for the requested session', async () => {
      const mine = await makeEnvironmentAndSession()
      const other = await makeEnvironmentAndSession()
      const mineEvent = await repos.events.append({
        sessionId: mine.sessionId,
        type: 'user',
        payload: {},
        direction: 'inbound',
      })
      await repos.events.append({ sessionId: other.sessionId, type: 'user', payload: {}, direction: 'inbound' })

      const rows = await repos.events.listSince(mine.sessionId, 0, 100)
      expect(rows.map((row) => row.id)).toEqual([mineEvent.id])
    })

    test('listBefore returns newest-first window reversed into display order', async () => {
      const { sessionId } = await makeEnvironmentAndSession()
      const first = await repos.events.append({ sessionId, type: 'a', payload: {}, direction: 'inbound' })
      const second = await repos.events.append({ sessionId, type: 'b', payload: {}, direction: 'inbound' })
      const third = await repos.events.append({ sessionId, type: 'c', payload: {}, direction: 'inbound' })

      const rows = await repos.events.listBefore(sessionId, third.id, 2)
      expect(rows.map((row) => row.id)).toEqual([first.id, second.id])

      const all = await repos.events.listBefore(sessionId, third.id, 100)
      expect(all.map((row) => row.id)).toEqual([first.id, second.id])
    })

    test('hasMessageUuid finds a stored message uuid, scoped to one session', async () => {
      const mine = await makeEnvironmentAndSession()
      const other = await makeEnvironmentAndSession()
      await repos.events.append({
        sessionId: mine.sessionId,
        type: 'assistant',
        payload: { uuid: 'msg-1' },
        direction: 'outbound',
        messageUuid: 'msg-1',
      })
      await repos.events.append({
        sessionId: other.sessionId,
        type: 'assistant',
        payload: { uuid: 'other-msg' },
        direction: 'outbound',
        messageUuid: 'other-msg',
      })

      expect(await repos.events.hasMessageUuid(mine.sessionId, 'msg-1')).toBe(true)
      expect(await repos.events.hasMessageUuid(mine.sessionId, 'other-msg')).toBe(false)
      expect(await repos.events.hasMessageUuid(other.sessionId, 'msg-1')).toBe(false)
    })

    test('hasMessageUuid ignores rows that carry no message uuid', async () => {
      const { sessionId } = await makeEnvironmentAndSession()
      // Streaming deltas keep a null message uuid so they are never mistaken for
      // a complete message replay.
      await repos.events.append({ sessionId, type: 'stream_event', payload: { uuid: 'chunk' }, direction: 'inbound' })

      expect(await repos.events.hasMessageUuid(sessionId, 'chunk')).toBe(false)
    })

    test('latestId returns the max id or null', async () => {
      const { sessionId } = await makeEnvironmentAndSession()
      expect(await repos.events.latestId(sessionId)).toBeNull()

      await repos.events.append({ sessionId, type: 'a', payload: {}, direction: 'inbound' })
      const last = await repos.events.append({ sessionId, type: 'b', payload: {}, direction: 'outbound' })

      expect(await repos.events.latestId(sessionId)).toBe(last.id)
      expect(await repos.events.latestId('cse_missing')).toBeNull()
    })
  })
}

repositorySuite('work, workers, and events (PGlite)', () => createRepositories(ctx.db))
repositorySuite('work, workers, and events (memory)', () => createMemoryRepositories())
