/**
 * Partial repository composition for users, API keys, environments, and sessions.
 *
 * Task 7 introduces the final `createRepositories` / `createMemoryRepositories`
 * factories that compose every repository module; this file only wires the pieces
 * that exist so far.
 */

import type { Database } from '../client.js'
import { createApiKeyRepository, createMemoryApiKeyRepository } from './api-keys.js'
import { createEnvironmentRepository, createMemoryEnvironmentRepository } from './environments.js'
import { createMemorySessionRepository, createSessionRepository } from './sessions.js'
import type { Repositories } from './types.js'
import { createMemoryUserRepository, createUserRepository } from './users.js'

export function createUserRepositories(db: Database): Repositories {
  return {
    users: createUserRepository(db),
    apiKeys: createApiKeyRepository(db),
    environments: createEnvironmentRepository(db),
    sessions: createSessionRepository(db),
  }
}

export function createMemoryUserRepositories(): Repositories {
  return {
    users: createMemoryUserRepository(),
    apiKeys: createMemoryApiKeyRepository(),
    environments: createMemoryEnvironmentRepository(),
    sessions: createMemorySessionRepository(),
  }
}

export { createApiKeyRepository, createMemoryApiKeyRepository } from './api-keys.js'
export { createEnvironmentRepository, createMemoryEnvironmentRepository } from './environments.js'
export { createMemorySessionRepository, createSessionRepository } from './sessions.js'
export type {
  ApiKeyRepository,
  CreateApiKeyInput,
  CreateEnvironmentInput,
  CreateSessionInput,
  CreateUserInput,
  EnvironmentPatch,
  EnvironmentRepository,
  FindReusableEnvironmentInput,
  ListActiveEnvironmentsOptions,
  Repositories,
  SessionListOptions,
  SessionPatch,
  SessionRepository,
  UserRepository,
} from './types.js'
export { createMemoryUserRepository, createUserRepository } from './users.js'
