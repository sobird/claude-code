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

/** Driver-specific runtime the `Database` type does not retain. */
interface DriverRuntime {
  close(): Promise<void>
  migrate(migrationsFolder: string): Promise<void>
}

const runtimes = new WeakMap<Database, DriverRuntime>()

export function createPostgresDatabase(url: string): Database {
  const client = postgres(url, { max: 10 })
  const db = drizzlePostgres(client, { schema })
  runtimes.set(db, {
    close: () => client.end(),
    async migrate(migrationsFolder) {
      const { migrate } = await import('drizzle-orm/postgres-js/migrator')
      await migrate(db, { migrationsFolder })
    },
  })
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
  const runtime: DriverRuntime = {
    close: () => client.close(),
    async migrate(migrationsFolder) {
      const { migrate } = await import('drizzle-orm/pglite/migrator')
      await migrate(db, { migrationsFolder })
    },
  }
  runtimes.set(db, runtime)
  return { db, close: runtime.close }
}

/** Close the underlying connection for a database created by this module. */
export async function closeDatabase(db: Database): Promise<void> {
  const runtime = runtimes.get(db)
  if (!runtime) return
  runtimes.delete(db)
  await runtime.close()
}

/** Apply committed SQL migrations to `db`. */
export async function runMigrations(db: Database): Promise<void> {
  const runtime = runtimes.get(db)
  if (!runtime) {
    throw new Error('Unknown database driver; create the database with createPostgresDatabase or createPgliteDatabase')
  }
  // Resolved via path APIs (not `new URL(..., import.meta.url)`) so bundlers do
  // not try to inline the migrations directory; this module is also imported by
  // the Next server, which never runs migrations.
  const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
  await runtime.migrate(migrationsFolder)
}
