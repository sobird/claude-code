/**
 * Lazy Postgres/repository singleton for the Next server.
 *
 * Created on first use (never at module import) so `next build` and Edge
 * middleware can load this module's siblings without `DATABASE_URL`. The Next
 * server (Node runtime) is single-process, so a module-level singleton is
 * enough; the gateway keeps its own pool.
 */

import { createPostgresDatabase, type Database } from '../db/client'
import { createRepositories } from '../db/repositories/index'
import type { Repositories } from '../db/repositories/types'

let cached: { db: Database; repos: Repositories } | null = null

/** Returns the process-wide repository bundle, creating the pool on first call. */
export function getRepositories(): Repositories {
  if (cached) return cached.repos

  const url = process.env.DATABASE_URL?.trim()
  if (!url) {
    throw new Error('DATABASE_URL is required to access the database')
  }

  const db = createPostgresDatabase(url)
  cached = { db, repos: createRepositories(db) }
  return cached.repos
}
