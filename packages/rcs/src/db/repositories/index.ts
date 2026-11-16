/**
 * Repository composition.
 *
 * `createRepositories` / `createMemoryRepositories` are the production and test
 * factories, composing every repository module (users, API keys, environments,
 * sessions, work items, session workers, events). The `*UserRepositories` aliases are
 * kept for earlier consumers that only need the user-facing subset.
 */

import type { Database } from '../client.js'
import { createApiKeyRepository, createMemoryApiKeyRepository } from './api-keys.js'
import { createEnvironmentRepository, createMemoryEnvironmentRepository } from './environments.js'
import { createEventRepository, createMemoryEventRepository } from './events.js'
import { createMemorySessionWorkerRepository, createSessionWorkerRepository } from './session-workers.js'
import { createMemorySessionRepository, createSessionRepository } from './sessions.js'
import type { Repositories } from './types.js'
import { createMemoryUserRepository, createUserRepository } from './users.js'
import { createMemoryWorkItemRepository, createWorkItemRepository } from './work-items.js'

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

export { createApiKeyRepository, createMemoryApiKeyRepository } from './api-keys.js'
export { createEnvironmentRepository, createMemoryEnvironmentRepository } from './environments.js'
export { createEventRepository, createMemoryEventRepository } from './events.js'
export { createMemorySessionRepository, createSessionRepository } from './sessions.js'
export { createMemorySessionWorkerRepository, createSessionWorkerRepository } from './session-workers.js'
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
} from './types.js'
export { createMemoryUserRepository, createUserRepository } from './users.js'
export { createMemoryWorkItemRepository, createWorkItemRepository } from './work-items.js'
