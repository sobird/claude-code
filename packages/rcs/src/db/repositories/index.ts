/**
 * Repository composition.
 *
 * `createRepositories` / `createMemoryRepositories` are the production and test
 * factories, composing every repository module (users, API keys, environments,
 * sessions, work items, session workers, events). The `*UserRepositories` aliases are
 * kept for earlier consumers that only need the user-facing subset.
 */

import type { Database } from '../client'
import { createApiKeyRepository, createMemoryApiKeyRepository } from './api-keys'
import { createEnvironmentRepository, createMemoryEnvironmentRepository } from './environments'
import { createEventRepository, createMemoryEventRepository } from './events'
import { createMemorySessionWorkerRepository, createSessionWorkerRepository } from './session-workers'
import { createMemorySessionRepository, createSessionRepository } from './sessions'
import type { Repositories } from './types'
import { createMemoryUserRepository, createUserRepository } from './users'
import { createMemoryWorkItemRepository, createWorkItemRepository } from './work-items'

export function createRepositories(db: Database): Repositories {
  return {
    users: createUserRepository(db),
    apiKeys: createApiKeyRepository(db),
    environments: createEnvironmentRepository(db),
    sessions: createSessionRepository(db),
    workItems: createWorkItemRepository(db),
    sessionWorkers: createSessionWorkerRepository(db),
    events: createEventRepository(db),
  }
}

export function createMemoryRepositories(): Repositories {
  return {
    users: createMemoryUserRepository(),
    apiKeys: createMemoryApiKeyRepository(),
    environments: createMemoryEnvironmentRepository(),
    sessions: createMemorySessionRepository(),
    workItems: createMemoryWorkItemRepository(),
    sessionWorkers: createMemorySessionWorkerRepository(),
    events: createMemoryEventRepository(),
  }
}

/** Kept for earlier consumers; identical to `createRepositories`. */
export const createUserRepositories = createRepositories

/** Kept for earlier consumers; identical to `createMemoryRepositories`. */
export const createMemoryUserRepositories = createMemoryRepositories

export { createApiKeyRepository, createMemoryApiKeyRepository } from './api-keys'
export { createEnvironmentRepository, createMemoryEnvironmentRepository } from './environments'
export { createEventRepository, createMemoryEventRepository } from './events'
export { createMemorySessionRepository, createSessionRepository } from './sessions'
export { createMemorySessionWorkerRepository, createSessionWorkerRepository } from './session-workers'
export type {
  ApiKeyRepository,
  AppendEventInput,
  CreateApiKeyInput,
  CreateEnvironmentInput,
  CreateSessionInput,
  CreateUserInput,
  EnqueueWorkItemInput,
  EnvironmentPatch,
  EnvironmentRepository,
  EventRepository,
  FindReusableEnvironmentInput,
  ListActiveEnvironmentsOptions,
  Repositories,
  SessionListOptions,
  SessionPatch,
  SessionRepository,
  SessionWorkerPatch,
  SessionWorkerRepository,
  UserRepository,
  WorkItemRepository,
} from './types'
export { createMemoryUserRepository, createUserRepository } from './users'
export { createMemoryWorkItemRepository, createWorkItemRepository } from './work-items'
