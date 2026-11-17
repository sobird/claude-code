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

    test('enqueue reuses a pending item for the same session instead of stacking work', async () => {
      const { environmentId, sessionId } = await makeEnvironmentAndSession()
      const first = await repos.workItems.enqueue({ environmentId, sessionId, secret: 'old' })
      const second = await repos.workItems.enqueue({ environmentId, sessionId, secret: 'new' })

      expect(second.id).toBe(first.id)
      expect(second.state).toBe('pending')
      expect(second.secret).toBe('new')
      // Exactly one claimable item: the duplicate dispatch path is gone.
      expect((await repos.workItems.claimNext(environmentId))?.secret).toBe('new')
      expect(await repos.workItems.claimNext(environmentId)).toBeNull()
    })

    test('concurrent enqueues for one session converge on a single item', async () => {
      const { environmentId, sessionId } = await makeEnvironmentAndSession()
      const [a, b] = await Promise.all([
        repos.workItems.enqueue({ environmentId, sessionId, secret: 'a' }),
        repos.workItems.enqueue({ environmentId, sessionId, secret: 'b' }),
      ])

      expect(a.id).toBe(b.id)
      expect((await repos.workItems.claimNext(environmentId))?.id).toBe(a.id)
      expect(await repos.workItems.claimNext(environmentId)).toBeNull()
    })

    test('enqueue refreshes the secret of a dispatched item without duplicating it', async () => {
      const { environmentId, sessionId } = await makeEnvironmentAndSession()
      const item = await repos.workItems.enqueue({ environmentId, sessionId, secret: 'old' })
      await repos.workItems.claimNext(environmentId)

      const again = await repos.workItems.enqueue({ environmentId, sessionId, secret: 'new' })
      expect(again.id).toBe(item.id)
      expect(again.secret).toBe('new')
      expect((await repos.workItems.getById(item.id))?.state).toBe('dispatched')
      expect(await repos.workItems.claimNext(environmentId, { reclaimOlderThanMs: 60_000 })).toBeNull()
    })

    test('enqueue creates a fresh item once the previous one is acked', async () => {
      const { environmentId, sessionId } = await makeEnvironmentAndSession()
      const first = await repos.workItems.enqueue({ environmentId, sessionId, secret: 'old' })
      await repos.workItems.claimNext(environmentId)
      await repos.workItems.setState(first.id, 'acked')

      const second = await repos.workItems.enqueue({ environmentId, sessionId, secret: 'new' })
      expect(second.id).not.toBe(first.id)
      expect(second.state).toBe('pending')
    })

    test('getById returns null for unknown work items', async () => {
      expect(await repos.workItems.getById('work_missing')).toBeNull()
    })

    test('claimNext dispatches the oldest pending item for the environment only', async () => {
      const target = await makeEnvironmentAndSession()
      const other = await makeEnvironmentAndSession()
      // A second session in the same environment: one session only ever has one in-flight
      // work item, so the ordering assertion needs two distinct sessions.
      const secondSession = await repos.sessions.create({ environmentId: target.environmentId })
      const first = await repos.workItems.enqueue({
        environmentId: target.environmentId,
        sessionId: target.sessionId,
        secret: 'first',
      })
      // Space the rows out so `created_at` strictly orders them (ids are random UUIDs).
      await Bun.sleep(5)
      await repos.workItems.enqueue({
        environmentId: target.environmentId,
        sessionId: secondSession.id,
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

    test('claimNext reclaims a stale dispatched item when reclaimOlderThanMs elapses', async () => {
      const { environmentId, sessionId } = await makeEnvironmentAndSession()
      const item = await repos.workItems.enqueue({ environmentId, sessionId, secret: 'stale' })

      expect((await repos.workItems.claimNext(environmentId))?.id).toBe(item.id)
      await Bun.sleep(10)

      const reclaimed = await repos.workItems.claimNext(environmentId, { reclaimOlderThanMs: 1 })
      expect(reclaimed?.id).toBe(item.id)
      expect(reclaimed?.state).toBe('dispatched')
    })

    test('claimNext leaves a dispatched item alone inside the reclaim window', async () => {
      const { environmentId, sessionId } = await makeEnvironmentAndSession()
      await repos.workItems.enqueue({ environmentId, sessionId, secret: 'fresh' })
      await repos.workItems.claimNext(environmentId)

      expect(await repos.workItems.claimNext(environmentId, { reclaimOlderThanMs: 60_000 })).toBeNull()
    })

    test('claimNext does not reclaim acknowledged or completed items', async () => {
      const { environmentId, sessionId } = await makeEnvironmentAndSession()
      const acked = await repos.workItems.enqueue({ environmentId, sessionId, secret: 'acked' })
      await repos.workItems.claimNext(environmentId)
      await repos.workItems.setState(acked.id, 'acked')

      const completed = await repos.workItems.enqueue({ environmentId, sessionId, secret: 'completed' })
      await repos.workItems.claimNext(environmentId)
      await repos.workItems.setState(completed.id, 'completed')

      await Bun.sleep(10)
      expect(await repos.workItems.claimNext(environmentId, { reclaimOlderThanMs: 1 })).toBeNull()
      expect((await repos.workItems.getById(acked.id))?.state).toBe('acked')
      expect((await repos.workItems.getById(completed.id))?.state).toBe('completed')
    })

    test('claimNext never reclaims without an explicit positive threshold', async () => {
      const { environmentId, sessionId } = await makeEnvironmentAndSession()
      await repos.workItems.enqueue({ environmentId, sessionId, secret: 'stale' })
      await repos.workItems.claimNext(environmentId)
      await Bun.sleep(10)

      expect(await repos.workItems.claimNext(environmentId)).toBeNull()
      expect(await repos.workItems.claimNext(environmentId, { reclaimOlderThanMs: 0 })).toBeNull()
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

    test('session worker upsert merges concurrent partial patches without losing either', async () => {
      const { sessionId } = await makeEnvironmentAndSession()
      await repos.sessionWorkers.upsert(sessionId, { workerStatus: 'starting' })

      // Heartbeat and status updates arrive together; neither may overwrite the other
      // with a stale read snapshot.
      const heartbeat = new Date('2026-05-06T07:08:09.000Z')
      await Promise.all([
        repos.sessionWorkers.upsert(sessionId, { lastHeartbeatAt: heartbeat }),
        repos.sessionWorkers.upsert(sessionId, { workerStatus: 'running' }),
      ])

      const merged = await repos.sessionWorkers.get(sessionId)
      expect(merged?.workerStatus).toBe('running')
      expect(merged?.lastHeartbeatAt?.getTime()).toBe(heartbeat.getTime())
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

    test('appendIfAbsent stores the first inbound message uuid and drops the duplicate', async () => {
      const { sessionId } = await makeEnvironmentAndSession()
      const first = await repos.events.appendIfAbsent({
        sessionId,
        type: 'assistant',
        payload: { uuid: 'dup-1' },
        direction: 'inbound',
        messageUuid: 'dup-1',
      })
      const duplicate = await repos.events.appendIfAbsent({
        sessionId,
        type: 'assistant',
        payload: { uuid: 'dup-1' },
        direction: 'inbound',
        messageUuid: 'dup-1',
      })

      expect(first).not.toBeNull()
      expect(duplicate).toBeNull()
      expect(await repos.events.listSince(sessionId, 0, 100)).toHaveLength(1)
    })

    test('appendIfAbsent lets exactly one of two concurrent duplicates win', async () => {
      const { sessionId } = await makeEnvironmentAndSession()
      const input = {
        sessionId,
        type: 'assistant',
        payload: { uuid: 'race-1' },
        direction: 'inbound' as const,
        messageUuid: 'race-1',
      }

      const results = await Promise.all([repos.events.appendIfAbsent(input), repos.events.appendIfAbsent(input)])

      expect(results.filter(Boolean)).toHaveLength(1)
      expect(await repos.events.listSince(sessionId, 0, 100)).toHaveLength(1)
    })

    test('appendIfAbsent scopes the dedupe key to one session', async () => {
      const mine = await makeEnvironmentAndSession()
      const other = await makeEnvironmentAndSession()

      const first = await repos.events.appendIfAbsent({
        sessionId: mine.sessionId,
        type: 'assistant',
        payload: {},
        direction: 'inbound',
        messageUuid: 'shared-1',
      })
      const second = await repos.events.appendIfAbsent({
        sessionId: other.sessionId,
        type: 'assistant',
        payload: {},
        direction: 'inbound',
        messageUuid: 'shared-1',
      })

      expect(first).not.toBeNull()
      expect(second).not.toBeNull()
    })

    test('appendIfAbsent ignores outbound rewrites and uuid-less events', async () => {
      const { sessionId } = await makeEnvironmentAndSession()
      // The server may rewrite the same outbound message uuid; only inbound can conflict.
      await repos.events.append({
        sessionId,
        type: 'assistant',
        payload: {},
        direction: 'outbound',
        messageUuid: 'o-1',
      })
      const outboundAgain = await repos.events.append({
        sessionId,
        type: 'assistant',
        payload: {},
        direction: 'outbound',
        messageUuid: 'o-1',
      })
      // Streaming deltas share a uuid but carry no message uuid, so they never dedupe.
      const chunkA = await repos.events.appendIfAbsent({
        sessionId,
        type: 'stream_event',
        payload: {},
        direction: 'inbound',
      })
      const chunkB = await repos.events.appendIfAbsent({
        sessionId,
        type: 'stream_event',
        payload: {},
        direction: 'inbound',
      })

      expect(outboundAgain).not.toBeNull()
      expect(chunkA).not.toBeNull()
      expect(chunkB).not.toBeNull()
    })

    test('latestCreatedAt returns null without events and the newest event time otherwise', async () => {
      const { sessionId } = await makeEnvironmentAndSession()
      expect(await repos.events.latestCreatedAt(sessionId)).toBeNull()

      const first = await repos.events.append({ sessionId, type: 'a', payload: {}, direction: 'inbound' })
      const last = await repos.events.append({ sessionId, type: 'b', payload: {}, direction: 'outbound' })

      expect((await repos.events.latestCreatedAt(sessionId))?.getTime()).toBe(last.createdAt.getTime())
      expect(last.createdAt.getTime()).toBeGreaterThanOrEqual(first.createdAt.getTime())
      expect(await repos.events.latestCreatedAt('cse_missing')).toBeNull()
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
