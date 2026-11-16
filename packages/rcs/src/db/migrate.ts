/**
 * Standalone migration entrypoint.
 *
 * Bundled as `dist/migrate.js` (Task 20) and invoked directly; keeps all side effects
 * inside `main` so importing this module never touches the environment.
 */

import { closeDatabase, createPostgresDatabase, runMigrations } from './client.js'

export async function main(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) {
    throw new Error('DATABASE_URL is required')
  }
  const db = createPostgresDatabase(url)
  try {
    await runMigrations(db)
  } finally {
    await closeDatabase(db)
  }
}

if (import.meta.main) {
  await main()
}
