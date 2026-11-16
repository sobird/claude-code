/**
 * Environment repository: Postgres (Drizzle) and in-memory implementations.
 *
 * `findReusable` is ownership-safe: it only returns an active environment whose
 * `ownerUserId` matches the caller, so a stale or foreign `environment_id` can never
 * reattach a client to another user's environment.
 */

import { and, asc, eq } from 'drizzle-orm'

import type { EnvironmentRecord } from '../../contracts.js'
import type { Database } from '../client.js'
import { environments } from '../schema.js'
import type { CreateEnvironmentInput, EnvironmentPatch, EnvironmentRepository } from './types.js'

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

    async findReusable(input) {
      const [row] = await db
        .select()
        .from(environments)
        .where(
          and(
            eq(environments.id, input.environmentId),
            eq(environments.ownerUserId, input.ownerUserId),
            eq(environments.status, 'active'),
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

function cloneEnvironment(record: EnvironmentRecord): EnvironmentRecord {
  return {
    ...record,
    capabilities: record.capabilities ? { ...record.capabilities } : null,
    lastPollAt: record.lastPollAt ? new Date(record.lastPollAt) : null,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  }
}

export function createMemoryEnvironmentRepository(): EnvironmentRepository {
  const byId = new Map<string, EnvironmentRecord>()

  return {
    async create(input: CreateEnvironmentInput) {
      const id = input.id ?? `env_${crypto.randomUUID()}`
      if (byId.has(id)) {
        throw new Error(`environment already exists: ${id}`)
      }
      const now = new Date()
      const record: EnvironmentRecord = {
        id,
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
        lastPollAt: input.lastPollAt ? new Date(input.lastPollAt) : null,
        createdAt: now,
        updatedAt: now,
      }
      byId.set(id, record)
      return cloneEnvironment(record)
    },

    async getById(id) {
      const record = byId.get(id)
      return record ? cloneEnvironment(record) : null
    },

    async update(id, patch: EnvironmentPatch) {
      const record = byId.get(id)
      if (!record) return
      Object.assign(record, definedPatch(patch), { updatedAt: new Date() })
      record.lastPollAt = record.lastPollAt ? new Date(record.lastPollAt) : null
    },

    async listActive(options) {
      return [...byId.values()]
        .filter(
          (record) =>
            record.status === 'active' &&
            (options?.ownerUserId === undefined || record.ownerUserId === options.ownerUserId),
        )
        .map(cloneEnvironment)
        .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    },

    async findReusable(input) {
      const record = byId.get(input.environmentId)
      if (!record) return null
      if (record.ownerUserId !== input.ownerUserId || record.status !== 'active') return null
      return cloneEnvironment(record)
    },

    async listByWorkerType(workerType, options) {
      return [...byId.values()]
        .filter(
          (record) =>
            record.workerType === workerType &&
            (options?.ownerUserId === undefined || record.ownerUserId === options.ownerUserId),
        )
        .map(cloneEnvironment)
        .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    },
  }
}

/** Drop `undefined` entries so a partial patch never erases stored values. */
function definedPatch(patch: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
}
