/**
 * Repository composition.
 *
 * `createRepositories` is the production factory, composing every repository module
 * (users, API keys, environments, sessions, work items, session workers, events).
 * 测试用 `@/db/testing` 的 PGlite 数据库配同一个工厂，不再维护内存副本。
 */

import type { Database } from '@/db/client'

import { createApiKeyRepository } from './api-keys'
import { createAttachmentRepository } from './attachments'
import { createEnvironmentRepository } from './environments'
import { createEventRepository } from './events'
import { createPushSettingsRepository } from './push-settings'
import { createPushSubscriptionRepository } from './push-subscriptions'
import { createSessionReadRepository } from './session-reads'
import { createSessionWorkerRepository } from './session-workers'
import { createSessionRepository } from './sessions'
import type { Repositories } from './types'
import { createUserRepository } from './users'
import { createWorkItemRepository } from './work-items'

export function createRepositories(db: Database): Repositories {
  return {
    users: createUserRepository(db),
    apiKeys: createApiKeyRepository(db),
    environments: createEnvironmentRepository(db),
    sessions: createSessionRepository(db),
    workItems: createWorkItemRepository(db),
    sessionWorkers: createSessionWorkerRepository(db),
    sessionReads: createSessionReadRepository(db),
    events: createEventRepository(db),
    attachments: createAttachmentRepository(db),
    pushSubscriptions: createPushSubscriptionRepository(db),
    pushSettings: createPushSettingsRepository(db),
  }
}

/** Kept for earlier consumers; identical to `createRepositories`. */
export const createUserRepositories = createRepositories

export { createApiKeyRepository } from './api-keys'
export { createAttachmentRepository } from './attachments'
export { createEnvironmentRepository } from './environments'
export { createEventRepository } from './events'
export { createPushSettingsRepository } from './push-settings'
export { createPushSubscriptionRepository } from './push-subscriptions'
export { createSessionReadRepository } from './session-reads'
export { createSessionRepository } from './sessions'
export { createSessionWorkerRepository } from './session-workers'
export type {
  ApiKeyRepository,
  AppendEventInput,
  AttachmentRepository,
  CreateAttachmentInput,
  CreateApiKeyInput,
  CreateEnvironmentInput,
  CreatePushSubscriptionInput,
  CreateSessionInput,
  CreateUserInput,
  EnqueueWorkItemInput,
  EnvironmentPatch,
  EnvironmentRepository,
  EventRepository,
  FindReusableEnvironmentInput,
  ListActiveEnvironmentsOptions,
  PushSettingsRepository,
  PushSubscriptionRepository,
  Repositories,
  SessionListOptions,
  SessionPatch,
  SessionReadBaseline,
  SessionReadRepository,
  SessionRepository,
  SessionWorkerPatch,
  SessionWorkerRepository,
  UserRepository,
  WorkItemRepository,
} from './types'
export { createUserRepository } from './users'
export { createWorkItemRepository } from './work-items'
