import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPgliteDatabase, runMigrations } from '@/db/client'
import { createMemoryUserRepositories, createUserRepositories } from '@/db/repositories'
import type { Repositories } from '@/db/repositories'

const ctx = await createPgliteDatabase()
await runMigrations(ctx.db)
afterAll(() => ctx.close())

/**
 * Both implementations must satisfy the same assertions. The Postgres half shares one
 * migrated PGlite database (each test uses unique users/ids, so ownership queries stay
 * scoped); the memory half gets a fresh empty store per test.
 */
function repositorySuite(name: string, makeRepos: () => Repositories): void {
  describe(name, () => {
    let repos: Repositories

    beforeEach(() => {
      repos = makeRepos()
    })

    test('environment create fills defaults and generates an env_ id', async () => {
      const owner = await repos.users.create({ username: 'env-owner', passwordHash: 'x', role: 'member' })
      const env = await repos.environments.create({
        ownerUserId: owner.id,
        workerType: 'claude_code',
        maxSessions: 2,
      })

      expect(env.id.startsWith('env_')).toBe(true)
      expect(env.ownerUserId).toBe(owner.id)
      expect(env.machineName).toBeNull()
      expect(env.directory).toBeNull()
      expect(env.branch).toBeNull()
      expect(env.gitRepoUrl).toBeNull()
      expect(env.bridgeId).toBeNull()
      expect(env.maxSessions).toBe(2)
      expect(env.workerType).toBe('claude_code')
      expect(env.capabilities).toEqual({})
      expect(env.status).toBe('active')
      expect(env.lastPollAt).toBeNull()
      expect(env.createdAt).toBeInstanceOf(Date)
      expect(env.updatedAt).toBeInstanceOf(Date)
    })

    test('environment create accepts an explicit id and every field', async () => {
      const owner = await repos.users.create({ username: 'env-explicit', passwordHash: 'x', role: 'member' })
      const env = await repos.environments.create({
        id: 'env_explicit',
        ownerUserId: owner.id,
        machineName: 'box',
        directory: '/work',
        branch: 'main',
        gitRepoUrl: 'git@example.com:repo.git',
        maxSessions: 3,
        workerType: 'acp',
        bridgeId: 'bridge_1',
        capabilities: { acp: true },
      })

      expect(env.id).toBe('env_explicit')
      expect(env.machineName).toBe('box')
      expect(env.directory).toBe('/work')
      expect(env.branch).toBe('main')
      expect(env.gitRepoUrl).toBe('git@example.com:repo.git')
      expect(env.maxSessions).toBe(3)
      expect(env.workerType).toBe('acp')
      expect(env.bridgeId).toBe('bridge_1')
      expect(env.capabilities).toEqual({ acp: true })
    })

    test('environment update patches fields and bumps updatedAt', async () => {
      const owner = await repos.users.create({ username: 'env-update', passwordHash: 'x', role: 'member' })
      const env = await repos.environments.create({ ownerUserId: owner.id })
      const lastPollAt = new Date('2026-03-04T05:06:07.000Z')

      await repos.environments.update(env.id, { status: 'inactive', machineName: 'renamed', lastPollAt })
      const updated = await repos.environments.getById(env.id)

      expect(updated?.status).toBe('inactive')
      expect(updated?.machineName).toBe('renamed')
      expect(updated?.lastPollAt?.getTime()).toBe(lastPollAt.getTime())
      expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(env.updatedAt.getTime())
    })

    test('getById returns null for unknown environments', async () => {
      expect(await repos.environments.getById('env_missing')).toBeNull()
    })

    test('listActive returns active environments, optionally scoped to an owner', async () => {
      const owner = await repos.users.create({ username: 'env-list-owner', passwordHash: 'x', role: 'member' })
      const other = await repos.users.create({ username: 'env-list-other', passwordHash: 'x', role: 'member' })
      const first = await repos.environments.create({ ownerUserId: owner.id })
      const second = await repos.environments.create({ ownerUserId: owner.id })
      const foreign = await repos.environments.create({ ownerUserId: other.id })
      const inactive = await repos.environments.create({ ownerUserId: owner.id })
      await repos.environments.update(inactive.id, { status: 'inactive' })

      const all = (await repos.environments.listActive()).map((env) => env.id)
      expect(all).toContain(first.id)
      expect(all).toContain(second.id)
      expect(all).toContain(foreign.id)
      expect(all).not.toContain(inactive.id)

      const scoped = (await repos.environments.listActive({ ownerUserId: owner.id })).map((env) => env.id)
      expect(scoped).toContain(first.id)
      expect(scoped).toContain(second.id)
      expect(scoped).not.toContain(foreign.id)
      expect(scoped).not.toContain(inactive.id)
    })

    test('listByWorkerType returns all statuses, ordered, optionally scoped to an owner', async () => {
      const owner = await repos.users.create({ username: 'wt-owner', passwordHash: 'x', role: 'member' })
      const other = await repos.users.create({ username: 'wt-other', passwordHash: 'x', role: 'member' })
      const first = await repos.environments.create({ ownerUserId: owner.id, workerType: 'acp', bridgeId: 'g1' })
      const second = await repos.environments.create({ ownerUserId: owner.id, workerType: 'acp', bridgeId: 'g1' })
      const foreign = await repos.environments.create({ ownerUserId: other.id, workerType: 'acp', bridgeId: 'g2' })
      const claude = await repos.environments.create({ ownerUserId: owner.id, workerType: 'claude_code' })
      await repos.environments.update(second.id, { status: 'offline' })

      const all = await repos.environments.listByWorkerType('acp')
      const allIds = all.map((env) => env.id)
      expect(allIds).toContain(first.id)
      expect(allIds).toContain(second.id)
      expect(allIds).toContain(foreign.id)
      expect(allIds).not.toContain(claude.id)
      expect(all.find((env) => env.id === second.id)?.status).toBe('offline')
      for (let i = 1; i < all.length; i += 1) {
        expect(all[i]?.createdAt.getTime()).toBeGreaterThanOrEqual(all[i - 1]?.createdAt.getTime())
      }

      const scoped = await repos.environments.listByWorkerType('acp', { ownerUserId: owner.id })
      expect(scoped.map((env) => env.id).toSorted()).toEqual([first.id, second.id].toSorted())

      expect(await repos.environments.listByWorkerType('missing_type')).toEqual([])
    })

    test('re-registration only reuses an environment owned by the caller', async () => {
      const owner = await repos.users.create({ username: 'owner', passwordHash: 'x', role: 'member' })
      const other = await repos.users.create({ username: 'other', passwordHash: 'x', role: 'member' })
      const env = await repos.environments.create({ ownerUserId: owner.id, workerType: 'claude_code', maxSessions: 1 })

      expect((await repos.environments.findReusable({ environmentId: env.id, ownerUserId: owner.id }))?.id).toBe(env.id)
      expect(await repos.environments.findReusable({ environmentId: env.id, ownerUserId: other.id })).toBeNull()
    })

    test('findReusable reuses a disconnected environment owned by the caller', async () => {
      const owner = await repos.users.create({ username: 'reuse-disconnected', passwordHash: 'x', role: 'member' })
      const other = await repos.users.create({ username: 'reuse-other', passwordHash: 'x', role: 'member' })
      const env = await repos.environments.create({ ownerUserId: owner.id })
      await repos.environments.update(env.id, { status: 'disconnected' })

      expect((await repos.environments.findReusable({ environmentId: env.id, ownerUserId: owner.id }))?.id).toBe(env.id)
      expect(await repos.environments.findReusable({ environmentId: env.id, ownerUserId: other.id })).toBeNull()
    })

    test('findReusable ignores inactive environments and unknown ids', async () => {
      const owner = await repos.users.create({ username: 'reuse-owner', passwordHash: 'x', role: 'member' })
      const env = await repos.environments.create({ ownerUserId: owner.id })
      await repos.environments.update(env.id, { status: 'deregistered' })

      expect(await repos.environments.findReusable({ environmentId: env.id, ownerUserId: owner.id })).toBeNull()
      expect(await repos.environments.findReusable({ environmentId: 'env_missing', ownerUserId: owner.id })).toBeNull()
    })

    test('session create fills defaults and generates a cse_ id', async () => {
      const session = await repos.sessions.create({})

      expect(session.id.startsWith('cse_')).toBe(true)
      expect(session.environmentId).toBeNull()
      expect(session.ownerUserId).toBeNull()
      expect(session.title).toBeNull()
      expect(session.status).toBe('idle')
      expect(session.source).toBe('remote-control')
      expect(session.permissionMode).toBeNull()
      expect(session.workerEpoch).toBe(0)
      expect(session.archivedAt).toBeNull()
      expect(session.createdAt).toBeInstanceOf(Date)
      expect(session.updatedAt).toBeInstanceOf(Date)
    })

    test('session create accepts an explicit id and supplied fields', async () => {
      const owner = await repos.users.create({ username: 'session-owner', passwordHash: 'x', role: 'member' })
      const env = await repos.environments.create({ ownerUserId: owner.id })
      const session = await repos.sessions.create({
        id: 'cse_explicit',
        environmentId: env.id,
        ownerUserId: owner.id,
        title: 'Build login',
        status: 'running',
        source: 'web',
        permissionMode: 'acceptEdits',
      })

      expect(session.id).toBe('cse_explicit')
      expect(session.environmentId).toBe(env.id)
      expect(session.ownerUserId).toBe(owner.id)
      expect(session.title).toBe('Build login')
      expect(session.status).toBe('running')
      expect(session.source).toBe('web')
      expect(session.permissionMode).toBe('acceptEdits')
    })

    test('session update patches fields and bumps updatedAt', async () => {
      const session = await repos.sessions.create({ id: 'cse_update' })
      await repos.sessions.update(session.id, { status: 'running', title: 'Renamed', permissionMode: 'plan' })
      const updated = await repos.sessions.getById(session.id)

      expect(updated?.status).toBe('running')
      expect(updated?.title).toBe('Renamed')
      expect(updated?.permissionMode).toBe('plan')
      expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(session.updatedAt.getTime())
    })

    test('getById returns null for unknown sessions', async () => {
      expect(await repos.sessions.getById('cse_missing')).toBeNull()
    })

    test('claimUnowned assigns exactly once', async () => {
      const a = await repos.users.create({ username: 'a', passwordHash: 'x', role: 'member' })
      const b = await repos.users.create({ username: 'b', passwordHash: 'x', role: 'member' })
      const session = await repos.sessions.create({ ownerUserId: null, source: 'remote-control', status: 'idle' })

      expect(await repos.sessions.claimUnowned(session.id, a.id)).toBe(true)
      expect(await repos.sessions.claimUnowned(session.id, b.id)).toBe(false)
      expect((await repos.sessions.getById(session.id))?.ownerUserId).toBe(a.id)
    })

    test('concurrent claimUnowned lets exactly one caller win', async () => {
      const a = await repos.users.create({ username: 'race-a', passwordHash: 'x', role: 'member' })
      const b = await repos.users.create({ username: 'race-b', passwordHash: 'x', role: 'member' })
      const session = await repos.sessions.create({ ownerUserId: null, source: 'acp' })

      const results = await Promise.all([
        repos.sessions.claimUnowned(session.id, a.id),
        repos.sessions.claimUnowned(session.id, b.id),
      ])

      expect(results.filter(Boolean)).toHaveLength(1)
      const stored = await repos.sessions.getById(session.id)
      const claimedOwner = stored?.ownerUserId
      expect(claimedOwner === a.id || claimedOwner === b.id).toBe(true)
    })

    test('claimUnowned never reassigns an already-owned session', async () => {
      const owner = await repos.users.create({ username: 'claim-owner', passwordHash: 'x', role: 'member' })
      const other = await repos.users.create({ username: 'claim-other', passwordHash: 'x', role: 'member' })
      const session = await repos.sessions.create({ ownerUserId: owner.id })

      expect(await repos.sessions.claimUnowned(session.id, other.id)).toBe(false)
      expect((await repos.sessions.getById(session.id))?.ownerUserId).toBe(owner.id)
    })

    test('listByOwner and listByEnvironment exclude archived rows unless asked', async () => {
      const owner = await repos.users.create({ username: 'archive-owner', passwordHash: 'x', role: 'member' })
      const env = await repos.environments.create({ ownerUserId: owner.id })
      const keep = await repos.sessions.create({ ownerUserId: owner.id, environmentId: env.id })
      const gone = await repos.sessions.create({ ownerUserId: owner.id, environmentId: env.id })
      const archivedAt = new Date('2026-04-05T06:07:08.000Z')

      await repos.sessions.archive(gone.id, archivedAt)

      const archived = await repos.sessions.getById(gone.id)
      expect(archived?.status).toBe('archived')
      expect(archived?.archivedAt?.getTime()).toBe(archivedAt.getTime())

      const byOwner = (await repos.sessions.listByOwner(owner.id)).map((session) => session.id)
      expect(byOwner).toContain(keep.id)
      expect(byOwner).not.toContain(gone.id)

      const byOwnerAll = (await repos.sessions.listByOwner(owner.id, { includeArchived: true })).map(
        (session) => session.id,
      )
      expect(byOwnerAll).toContain(keep.id)
      expect(byOwnerAll).toContain(gone.id)

      const byEnv = (await repos.sessions.listByEnvironment(env.id)).map((session) => session.id)
      expect(byEnv).toContain(keep.id)
      expect(byEnv).not.toContain(gone.id)

      const byEnvAll = (await repos.sessions.listByEnvironment(env.id, { includeArchived: true })).map(
        (session) => session.id,
      )
      expect(byEnvAll).toContain(gone.id)
    })

    test('listUnowned returns only unowned, non-archived sessions', async () => {
      const owner = await repos.users.create({ username: 'unowned-owner', passwordHash: 'x', role: 'member' })
      const first = await repos.sessions.create({ ownerUserId: null })
      const second = await repos.sessions.create({ ownerUserId: null })
      const owned = await repos.sessions.create({ ownerUserId: owner.id })
      const archived = await repos.sessions.create({ ownerUserId: null })
      await repos.sessions.archive(archived.id, new Date())

      const unowned = (await repos.sessions.listUnowned()).map((session) => session.id)
      expect(unowned).toContain(first.id)
      expect(unowned).toContain(second.id)
      expect(unowned).not.toContain(owned.id)
      expect(unowned).not.toContain(archived.id)

      const all = (await repos.sessions.listUnowned({ includeArchived: true })).map((session) => session.id)
      expect(all).toContain(archived.id)
    })

    test('incrementEpoch atomically advances and returns the new value', async () => {
      const session = await repos.sessions.create({ id: 'cse_epoch' })

      expect(await repos.sessions.incrementEpoch(session.id)).toBe(1)
      expect(await repos.sessions.incrementEpoch(session.id)).toBe(2)
      expect((await repos.sessions.getById(session.id))?.workerEpoch).toBe(2)
    })

    test('incrementEpoch throws for an unknown session', async () => {
      let error: unknown
      try {
        await repos.sessions.incrementEpoch('cse_missing')
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(Error)
    })
  })
}

repositorySuite('environments and sessions (PGlite)', () => createUserRepositories(ctx.db))
repositorySuite('environments and sessions (memory)', () => createMemoryUserRepositories())
