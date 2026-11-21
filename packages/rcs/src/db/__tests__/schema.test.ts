import { afterAll, expect, test } from 'bun:test'

import { sql } from 'drizzle-orm'

import { createPgliteDatabase, runMigrations } from '@/db/client'
import { schema, sessions, users } from '@/db/schema'

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

test('hot-path ownership lookups are indexed', async () => {
  // Env scoping lists sessions by environment, and key auth resolves keys by user.
  const result: unknown = await ctx.db.execute(sql`
    SELECT indexname FROM pg_indexes
    WHERE indexname IN ('sessions_environment_id_idx', 'api_keys_user_id_idx')
    ORDER BY indexname
  `)
  // PGlite returns `{ rows }`; the postgres-js driver returns a row list.
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as Array<{ indexname: string }>
  expect(rows.map((row) => row.indexname)).toEqual(['api_keys_user_id_idx', 'sessions_environment_id_idx'])
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
