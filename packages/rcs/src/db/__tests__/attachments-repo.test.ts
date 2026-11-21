import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import type { UserRecord } from '@/contracts'
import { createPgliteDatabase, runMigrations } from '@/db/client'
import { createMemoryRepositories, createRepositories } from '@/db/repositories'
import type { Repositories } from '@/db/repositories'

const ctx = await createPgliteDatabase()
await runMigrations(ctx.db)
afterAll(() => ctx.close())

function repositorySuite(name: string, makeRepos: () => Repositories): void {
  describe(name, () => {
    let repos: Repositories
    let owner: UserRecord
    let other: UserRecord

    beforeEach(async () => {
      repos = makeRepos()
      owner = await repos.users.create({
        username: `owner-${crypto.randomUUID()}`,
        passwordHash: 'x',
        role: 'member',
      })
      other = await repos.users.create({
        username: `other-${crypto.randomUUID()}`,
        passwordHash: 'x',
        role: 'member',
      })
    })

    test('createOrGet stores the bytes and returns an att_ id', async () => {
      const data = new Uint8Array([1, 2, 3, 4])
      const record = await repos.attachments.createOrGet({
        ownerUserId: owner.id,
        mediaType: 'image/png',
        sha256: 'abc',
        byteLength: data.byteLength,
        data,
      })

      expect(record.id.startsWith('att_')).toBe(true)
      expect(record.ownerUserId).toBe(owner.id)
      expect(record.mediaType).toBe('image/png')
      expect(record.sha256).toBe('abc')
      expect(record.byteLength).toBe(4)
      expect(Array.from(record.data)).toEqual([1, 2, 3, 4])
      expect(record.createdAt).toBeInstanceOf(Date)

      const fetched = await repos.attachments.getById(record.id)
      expect(fetched?.id).toBe(record.id)
      expect(Array.from(fetched?.data ?? [])).toEqual([1, 2, 3, 4])
    })

    test('createOrGet dedupes the same hash per owner', async () => {
      const input = { mediaType: 'image/png', sha256: 'dup', byteLength: 1, data: new Uint8Array([9]) }
      const first = await repos.attachments.createOrGet({ ...input, ownerUserId: owner.id })
      const second = await repos.attachments.createOrGet({ ...input, ownerUserId: owner.id })
      expect(second.id).toBe(first.id)
    })

    test('the same bytes stay separate across owners', async () => {
      const input = { mediaType: 'image/png', sha256: 'shared', byteLength: 1, data: new Uint8Array([9]) }
      const first = await repos.attachments.createOrGet({ ...input, ownerUserId: owner.id })
      const second = await repos.attachments.createOrGet({ ...input, ownerUserId: other.id })
      expect(second.id).not.toBe(first.id)
      expect(second.ownerUserId).toBe(other.id)
    })

    test('getById returns null for unknown ids', async () => {
      expect(await repos.attachments.getById('att_missing')).toBeNull()
    })
  })
}

repositorySuite('attachments repo (postgres/pglite)', () => createRepositories(ctx.db))
repositorySuite('attachments repo (memory)', () => createMemoryRepositories())
