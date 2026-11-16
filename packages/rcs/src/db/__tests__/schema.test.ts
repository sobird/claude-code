import { afterAll, expect, test } from 'bun:test'

import { createPgliteDatabase, runMigrations } from '../client.js'
import { schema, sessions, users } from '../schema.js'

const ctx = await createPgliteDatabase()
await runMigrations(ctx.db)
afterAll(() => ctx.close())

test('users username is unique and lowercase-normalized by callers', async () => {
  const row = { id: crypto.randomUUID(), username: 'alice', passwordHash: 'x', role: 'member' as const }
  await ctx.db.insert(users).values(row)
  let error: unknown
  try {
    await ctx.db.insert(users).values({ ...row, id: crypto.randomUUID() })
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(Error)
})

test('session events auto-increment ids', async () => {
  // session_events.session_id has a foreign key to sessions.id, so seed the parent row first.
  await ctx.db.insert(sessions).values({ id: 'cse_x' })
  const rows = await ctx.db
    .insert(schema.sessionEvents)
    .values([
      { eventId: crypto.randomUUID(), sessionId: 'cse_x', type: 'user', payload: {}, direction: 'inbound' },
      { eventId: crypto.randomUUID(), sessionId: 'cse_x', type: 'assistant', payload: {}, direction: 'inbound' },
    ])
    .returning()
  expect(rows[1].id).toBeGreaterThan(rows[0].id)
})
