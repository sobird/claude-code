import { describe, expect, test } from 'bun:test'

import { createTestRepositories, getTestDatabase, TEST_USER_IDS } from '@/db/testing'

describe('shared test database', () => {
  test('reuses one PGlite instance across calls', async () => {
    expect(await getTestDatabase()).toBe(await getTestDatabase())
  })

  test('createTestRepositories starts from an empty database', async () => {
    const first = await createTestRepositories()
    await first.users.create({ username: 'shared-db-check', passwordHash: 'x', role: 'member' })

    const second = await createTestRepositories()
    expect(await second.users.getByUsername('shared-db-check')).toBeNull()
  })

  test('enforces foreign keys when the owner row is missing', async () => {
    const repos = await createTestRepositories()
    await expect(
      repos.apiKeys.create({ userId: TEST_USER_IDS.user1, name: 'orphan', prefix: 'rcs_o', hash: 'orphan-1' }),
    ).rejects.toThrow()
  })

  test('seeds fixture users on request so owner references resolve', async () => {
    const repos = await createTestRepositories({ seedUsers: true })
    const key = await repos.apiKeys.create({ userId: TEST_USER_IDS.user1, name: 'key', prefix: 'rcs_k', hash: 'key-1' })
    expect(key.userId).toBe(TEST_USER_IDS.user1)
    expect((await repos.users.getByUsername('test-user-1'))?.id).toBe(TEST_USER_IDS.user1)
  })
})
