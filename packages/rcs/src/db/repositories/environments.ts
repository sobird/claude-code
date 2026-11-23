/**
 * Environment repository: Postgres (Drizzle) implementation.
 *
 * `findReusable` is ownership-safe: it only returns a live environment whose
 * `ownerUserId` matches the caller, so a stale or foreign `environment_id` can never
 * reattach a client to another user's environment. `disconnected`/`offline` are
 * worker-side liveness states the reaper sets, so they stay reusable; `deregistered` is a
 * deliberate owner action and does not.
 */

import { and, asc, eq, inArray } from 'drizzle-orm'

import type { Database } from '@/db/client'
import { environments } from '@/db/schema'

import type { EnvironmentRepository } from './types'

/** Statuses a returning worker may reclaim; deregistered/archived ids are not reusable. */
const REUSABLE_ENVIRONMENT_STATUSES = ['active', 'disconnected', 'offline']

/**
 * Statuses the web list shows. The reaper moves a quiet environment to `disconnected`
 * (`offline` for ACP) without removing it, so these count as present; only the explicit
 * `deregistered` action hides a row.
 */
const VISIBLE_ENVIRONMENT_STATUSES = ['active', 'disconnected', 'offline']

export function createEnvironmentRepository(db: Database): EnvironmentRepository {
  return {
    async create(input) {
      const now = new Date()
      const [row] = await db
        .insert(environments)
        .values({
          id: input.id ?? `env_${crypto.randomUUID()}`,
          ownerUserId: input.ownerUserId ?? null,
          machineName: input.machineName ?? null,
          directory: input.directory ?? null,
          branch: input.branch ?? null,
          gitRepoUrl: input.gitRepoUrl ?? null,
          maxSessions: input.maxSessions ?? 1,
          workerType: input.workerType ?? 'claude_code',
          bridgeId: input.bridgeId ?? null,
          capabilities: input.capabilities === undefined ? {} : input.capabilities,
          status: input.status ?? 'active',
          lastPollAt: input.lastPollAt ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
      return row
    },

    async getById(id) {
      const [row] = await db.select().from(environments).where(eq(environments.id, id)).limit(1)
      return row ?? null
    },

    async update(id, patch) {
      await db
        .update(environments)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(environments.id, id))
    },

    async listActive(options) {
      const conditions = [eq(environments.status, 'active')]
      if (options?.ownerUserId !== undefined) {
        conditions.push(eq(environments.ownerUserId, options.ownerUserId))
      }
      return db
        .select()
        .from(environments)
        .where(and(...conditions))
        .orderBy(asc(environments.createdAt), asc(environments.id))
    },

    async listVisible(options) {
      const conditions = [inArray(environments.status, VISIBLE_ENVIRONMENT_STATUSES)]
      if (options?.ownerUserId !== undefined) {
        conditions.push(eq(environments.ownerUserId, options.ownerUserId))
      }
      return db
        .select()
        .from(environments)
        .where(and(...conditions))
        .orderBy(asc(environments.createdAt), asc(environments.id))
    },

    async findReusable(input) {
      const [row] = await db
        .select()
        .from(environments)
        .where(
          and(
            eq(environments.id, input.environmentId),
            eq(environments.ownerUserId, input.ownerUserId),
            inArray(environments.status, REUSABLE_ENVIRONMENT_STATUSES),
          ),
        )
        .limit(1)
      return row ?? null
    },

    async listByWorkerType(workerType, options) {
      const conditions = [eq(environments.workerType, workerType)]
      if (options?.ownerUserId !== undefined) {
        conditions.push(eq(environments.ownerUserId, options.ownerUserId))
      }
      return db
        .select()
        .from(environments)
        .where(and(...conditions))
        .orderBy(asc(environments.createdAt), asc(environments.id))
    },
  }
}
