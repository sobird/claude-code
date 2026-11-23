import { beforeEach, describe, expect, test } from 'bun:test'

import type { Repositories } from '@/db/repositories'
import { createTestRepositories, TEST_USER_IDS } from '@/db/testing'
import { publishSessionEvent } from '@/transport/event-bus'

const userId = TEST_USER_IDS.user1

async function makeSession(repos: Repositories): Promise<string> {
  const tag = crypto.randomUUID()
  const session = await repos.sessions.create({ id: `cse_${tag}` })
  return session.id
}

describe('session read state repository', () => {
  let repos: Repositories

  beforeEach(async () => {
    repos = await createTestRepositories({ seedUsers: true })
  })

  test('ensureBaseline writes the current watermark only for sessions without a row', async () => {
    const existed = await makeSession(repos)
    const missing = await makeSession(repos)
    await repos.sessionReads.acknowledge(userId, existed, 3)

    await repos.sessionReads.ensureBaseline(userId, [
      { sessionId: existed, lastResultSeq: 9 },
      { sessionId: missing, lastResultSeq: 7 },
    ])

    expect((await repos.sessionReads.get(userId, existed))?.lastReadSeq).toBe(3)
    expect((await repos.sessionReads.get(userId, missing))?.lastReadSeq).toBe(7)
  })

  test('acknowledge advances monotonically and preserves a manual unread mark', async () => {
    const sessionId = await makeSession(repos)
    await repos.sessionReads.markUnread(userId, sessionId)
    await repos.sessionReads.acknowledge(userId, sessionId, 5)
    await repos.sessionReads.acknowledge(userId, sessionId, 2)

    const row = await repos.sessionReads.get(userId, sessionId)
    expect(row?.lastReadSeq).toBe(5)
    expect(row?.manualUnread).toBe(true)
  })

  test('acknowledge on a missing row starts read', async () => {
    const sessionId = await makeSession(repos)
    await repos.sessionReads.acknowledge(userId, sessionId, 4)

    const row = await repos.sessionReads.get(userId, sessionId)
    expect(row?.lastReadSeq).toBe(4)
    expect(row?.manualUnread).toBe(false)
  })

  test('markRead clears the manual flag and advances the watermark', async () => {
    const sessionId = await makeSession(repos)
    await repos.sessionReads.markUnread(userId, sessionId)
    await repos.sessionReads.markRead(userId, sessionId, 6)

    const row = await repos.sessionReads.get(userId, sessionId)
    expect(row?.lastReadSeq).toBe(6)
    expect(row?.manualUnread).toBe(false)
  })

  test('read state is per user', async () => {
    const sessionId = await makeSession(repos)
    await repos.sessionReads.acknowledge(userId, sessionId, 8)

    expect(await repos.sessionReads.get(TEST_USER_IDS.user2, sessionId)).toBeNull()
    expect(await repos.sessionReads.listByUser(TEST_USER_IDS.user2)).toEqual([])
  })

  test('listByUser filters by session ids', async () => {
    const first = await makeSession(repos)
    const second = await makeSession(repos)
    await repos.sessionReads.acknowledge(userId, first, 1)
    await repos.sessionReads.acknowledge(userId, second, 2)

    const rows = await repos.sessionReads.listByUser(userId, [first])
    expect(rows.map((row) => row.sessionId)).toEqual([first])
  })
})

describe('turn result watermark', () => {
  let repos: Repositories
  let sessionId: string

  beforeEach(async () => {
    repos = await createTestRepositories({ seedUsers: true })
    sessionId = await makeSession(repos)
  })

  test('an inbound result records the seq and failure flag', async () => {
    const event = await publishSessionEvent(
      repos,
      null,
      sessionId,
      'result',
      {
        uuid: crypto.randomUUID(),
        subtype: 'error_max_turns',
      },
      'inbound',
    )

    const session = await repos.sessions.getById(sessionId)
    expect(session?.lastResultSeq).toBe(event?.seqNum ?? -1)
    expect(session?.lastResultFailed).toBe(true)
  })

  test('a later successful result clears the failure flag', async () => {
    await publishSessionEvent(
      repos,
      null,
      sessionId,
      'result',
      {
        uuid: crypto.randomUUID(),
        subtype: 'error_during_execution',
      },
      'inbound',
    )
    await publishSessionEvent(
      repos,
      null,
      sessionId,
      'result',
      {
        uuid: crypto.randomUUID(),
        subtype: 'success',
      },
      'inbound',
    )

    const session = await repos.sessions.getById(sessionId)
    expect(session?.lastResultFailed).toBe(false)
  })
})
