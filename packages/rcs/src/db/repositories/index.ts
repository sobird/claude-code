/**
 * Partial repository composition for users and API keys.
 *
 * Task 7 introduces the final `createRepositories` / `createMemoryRepositories`
 * factories that compose every repository module; this file only wires the pieces
 * that exist so far.
 */

import type { Database } from '../client.js'
import { createApiKeyRepository, createMemoryApiKeyRepository } from './api-keys.js'
import type { Repositories } from './types.js'
import { createMemoryUserRepository, createUserRepository } from './users.js'

export function createUserRepositories(db: Database): Repositories {
  return {
    users: createUserRepository(db),
    apiKeys: createApiKeyRepository(db),
  }
}

export function createMemoryUserRepositories(): Repositories {
  return {
    users: createMemoryUserRepository(),
    apiKeys: createMemoryApiKeyRepository(),
  }
}

export { createApiKeyRepository, createMemoryApiKeyRepository } from './api-keys.js'
export type { ApiKeyRepository, CreateApiKeyInput, CreateUserInput, Repositories, UserRepository } from './types.js'
export { createMemoryUserRepository, createUserRepository } from './users.js'
