/**
 * Environment service.
 *
 * Registration honors a client-supplied `environment_id` only when
 * `repos.environments.findReusable` returns it — i.e. it is active and owned by the
 * same user. A stale or foreign id silently gets a fresh environment instead of
 * reattaching the client to somebody else's row. The `environment_secret` is a signed
 * environment token, not a shared API key.
 */

import { signEnvironmentToken } from '@/auth/tokens'
import { loadConfig } from '@/config'
import type { EnvironmentRecord } from '@/contracts'
import type { EnvironmentPatch, Repositories } from '@/db/repositories/types'

export interface RegisterEnvironmentInput {
  /** Previously issued environment id; reused only when still valid for this owner. */
  environmentId?: string | null
  ownerUserId: string
  machineName?: string | null
  directory?: string | null
  branch?: string | null
  gitRepoUrl?: string | null
  maxSessions?: number
  workerType?: string
  bridgeId?: string | null
  capabilities?: Record<string, unknown> | null
}

export interface RegisterEnvironmentResult {
  environment_id: string
  environment_secret: string
  status: string
  session_id?: string
}

export interface EnvironmentResponse {
  id: string
  machine_name: string | null
  directory: string | null
  branch: string | null
  status: string
  owner_user_id: string | null
  last_poll_at: number | null
  worker_type: string
  /** 该环境注册时声明的并发上限；bridge 类客户端通常保持默认 1。 */
  max_sessions: number
  channel_group_id: string | null
  capabilities: Record<string, unknown> | null
}

export interface ListActiveEnvironmentsOptions {
  ownerUserId?: string
  isAdmin?: boolean
}

export function toEnvironmentResponse(row: EnvironmentRecord): EnvironmentResponse {
  return {
    id: row.id,
    machine_name: row.machineName,
    directory: row.directory,
    branch: row.branch,
    status: row.status,
    owner_user_id: row.ownerUserId,
    last_poll_at: row.lastPollAt ? row.lastPollAt.getTime() / 1000 : null,
    worker_type: row.workerType,
    max_sessions: row.maxSessions,
    channel_group_id: row.bridgeId,
    capabilities: row.capabilities,
  }
}

function optionalPatch(input: RegisterEnvironmentInput): EnvironmentPatch {
  const patch: EnvironmentPatch = {}
  if (input.machineName !== undefined) patch.machineName = input.machineName
  if (input.directory !== undefined) patch.directory = input.directory
  if (input.branch !== undefined) patch.branch = input.branch
  if (input.gitRepoUrl !== undefined) patch.gitRepoUrl = input.gitRepoUrl
  if (input.maxSessions !== undefined) patch.maxSessions = input.maxSessions
  if (input.workerType !== undefined) patch.workerType = input.workerType
  if (input.bridgeId !== undefined) patch.bridgeId = input.bridgeId
  if (input.capabilities !== undefined) patch.capabilities = input.capabilities
  return patch
}

export async function registerEnvironment(
  repos: Repositories,
  input: RegisterEnvironmentInput,
): Promise<RegisterEnvironmentResult> {
  if (!input.ownerUserId) {
    throw new Error('ownerUserId is required to register an environment')
  }
  const ownerUserId = input.ownerUserId

  let record: EnvironmentRecord | null = null
  if (input.environmentId) {
    record = await repos.environments.findReusable({ environmentId: input.environmentId, ownerUserId })
    if (record) {
      await repos.environments.update(record.id, {
        ...optionalPatch(input),
        status: 'active',
        lastPollAt: new Date(),
      })
      record = (await repos.environments.getById(record.id)) ?? record
    }
  }

  if (!record) {
    record = await repos.environments.create({
      ownerUserId,
      machineName: input.machineName ?? null,
      directory: input.directory ?? null,
      branch: input.branch ?? null,
      gitRepoUrl: input.gitRepoUrl ?? null,
      maxSessions: input.maxSessions ?? 1,
      workerType: input.workerType ?? 'claude_code',
      bridgeId: input.bridgeId ?? null,
      capabilities: input.capabilities ?? null,
      status: 'active',
      lastPollAt: new Date(),
    })
  }

  let sessionId: string | undefined
  // ACP agents run one long-lived session per environment; reuse or create it.
  if (record.workerType === 'acp') {
    const existing = await repos.sessions.listByEnvironment(record.id)
    if (existing.length > 0) {
      sessionId = existing[0].id
    } else {
      const session = await repos.sessions.create({
        environmentId: record.id,
        ownerUserId: record.ownerUserId,
        title: input.machineName || 'ACP Agent',
        source: 'acp',
      })
      sessionId = session.id
    }
  }

  const config = loadConfig()
  const environmentSecret = await signEnvironmentToken(record.id, ownerUserId, config.envTokenTtl)

  return {
    environment_id: record.id,
    environment_secret: environmentSecret,
    status: record.status,
    session_id: sessionId,
  }
}

export async function deregisterEnvironment(repos: Repositories, environmentId: string): Promise<void> {
  await repos.environments.update(environmentId, { status: 'deregistered' })
}

export async function reconnectEnvironment(repos: Repositories, environmentId: string): Promise<void> {
  await repos.environments.update(environmentId, { status: 'active' })
}

/**
 * Record a successful poll and revive a worker-side liveness status. The reaper flips a
 * quiet environment to `disconnected`/`offline`; a poll is proof the worker is alive, so
 * ignoring it here would leave the environment permanently unusable. `deregistered` is a
 * deliberate owner action and is never revived.
 */
export async function updatePollTime(repos: Repositories, environmentId: string): Promise<void> {
  const environment = await repos.environments.getById(environmentId)
  if (!environment) return
  const revive = environment.status === 'disconnected' || environment.status === 'offline'
  await repos.environments.update(environmentId, {
    lastPollAt: new Date(),
    ...(revive ? { status: 'active' } : {}),
  })
}

export async function listActiveEnvironments(
  repos: Repositories,
  options: ListActiveEnvironmentsOptions = {},
): Promise<EnvironmentRecord[]> {
  if (options.isAdmin || !options.ownerUserId) {
    return repos.environments.listActive()
  }
  return repos.environments.listActive({ ownerUserId: options.ownerUserId })
}

/**
 * Environments still shown in the UI (`active`/`disconnected`/`offline`). Used by the web
 * list so a reaped-but-alive worker keeps its row with a status badge instead of vanishing
 * and reappearing each time the disconnect threshold trips.
 */
export async function listVisibleEnvironments(
  repos: Repositories,
  options: ListActiveEnvironmentsOptions = {},
): Promise<EnvironmentRecord[]> {
  if (options.isAdmin || !options.ownerUserId) {
    return repos.environments.listVisible()
  }
  return repos.environments.listVisible({ ownerUserId: options.ownerUserId })
}
