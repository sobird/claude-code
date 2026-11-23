/**
 * Database client factories and migration runner.
 *
 * Shared by the gateway (Bun) and the Next server (Node), so this module must stay free
 * of runtime-specific imports. `@electric-sql/pglite` is loaded lazily: it is a dev-only
 * dependency and production imports of this module must not require it.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { PgliteDatabase } from 'drizzle-orm/pglite'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { schema } from './schema'

export type Database = PgliteDatabase<typeof schema> | PostgresJsDatabase<typeof schema>

type Driver = 'postgres' | 'pglite'

/** The `Database` type does not retain which factory produced it, so track it here. */
const drivers = new WeakMap<Database, Driver>()
const closers = new WeakMap<Database, () => Promise<void>>()

export function createPostgresDatabase(url: string): Database {
  const client = postgres(url, { max: 10 })
  const db = drizzlePostgres(client, { schema })
  drivers.set(db, 'postgres')
  closers.set(db, () => client.end())
  return db
}

export async function createPgliteDatabase(): Promise<{
  db: PgliteDatabase<typeof schema>
  close(): Promise<void>
}> {
  const [{ PGlite }, { drizzle: drizzlePglite }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
  ])
  const client = new PGlite()
  const db = drizzlePglite(client, { schema })
  drivers.set(db, 'pglite')
  const close = () => client.close()
  closers.set(db, close)
  return { db, close }
}

/** Close the underlying connection for a database created by this module. */
export async function closeDatabase(db: Database): Promise<void> {
  const close = closers.get(db)
  if (!close) return
  closers.delete(db)
  await close()
}

async function applyMigrations(db: Database): Promise<void> {
  const driver = drivers.get(db)
  if (!driver) {
    throw new Error('Unknown database driver; create the database with createPostgresDatabase or createPgliteDatabase')
  }
  // Resolved via path APIs (not `new URL(..., import.meta.url)`) so bundlers do
  // not try to inline the migrations directory; this module is also imported by
  // the Next server, which never runs migrations.
  const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
  if (driver === 'pglite') {
    const { migrate } = await import('drizzle-orm/pglite/migrator')
    await migrate(db as PgliteDatabase<typeof schema>, { migrationsFolder })
    return
  }
  const { migrate } = await import('drizzle-orm/postgres-js/migrator')
  await migrate(db as PostgresJsDatabase<typeof schema>, { migrationsFolder })
}

/** Apply committed SQL migrations to `db`. */
export const runMigrations = applyMigrations

/** Semantic alias for test harnesses bootstrapping a fresh database. */
export const bootstrapSchema = applyMigrations
