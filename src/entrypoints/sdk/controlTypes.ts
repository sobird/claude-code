/**
 * SDK Control Types - Control protocol messages exchanged between SDK
 * implementations and the CLI.
 *
 * Derived from the Zod schemas in controlSchemas.ts (the runtime source of
 * truth for the protocol), so the static types cannot drift from validation.
 */
import type { z } from 'zod/v4'

import type {
  SDKControlCancelRequestSchema,
  SDKControlInitializeRequestSchema,
  SDKControlInitializeResponseSchema,
  SDKControlMcpSetServersResponseSchema,
  SDKControlPermissionRequestSchema,
  SDKControlReloadPluginsResponseSchema,
  SDKControlRequestInnerSchema,
  SDKControlRequestSchema,
  SDKControlResponseSchema,
  SDKKeepAliveMessageSchema,
  SDKUpdateEnvironmentVariablesMessageSchema,
} from './controlSchemas.js'
import type {
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKPostTurnSummaryMessage,
  SDKStreamlinedTextMessage,
  SDKStreamlinedToolUseSummaryMessage,
  SDKUserMessage,
} from './coreTypes.generated.js'

/** `lazySchema` wraps each schema in a memoized factory; infer from its product. */
type FromSchema<T extends () => z.ZodType> = z.infer<ReturnType<T>>

export type SDKControlRequest = FromSchema<typeof SDKControlRequestSchema>
export type SDKControlResponse = FromSchema<typeof SDKControlResponseSchema>
export type SDKControlRequestInner = FromSchema<typeof SDKControlRequestInnerSchema>
export type SDKControlPermissionRequest = FromSchema<typeof SDKControlPermissionRequestSchema>
export type SDKControlCancelRequest = FromSchema<typeof SDKControlCancelRequestSchema>
export type SDKControlInitializeRequest = FromSchema<typeof SDKControlInitializeRequestSchema>
export type SDKControlInitializeResponse = FromSchema<typeof SDKControlInitializeResponseSchema>
export type SDKControlMcpSetServersResponse = FromSchema<typeof SDKControlMcpSetServersResponseSchema>
export type SDKControlReloadPluginsResponse = FromSchema<typeof SDKControlReloadPluginsResponseSchema>
// Re-export the generated alias so the RawMessageStreamEvent placeholder
// override from coreTypes.generated.ts survives (the raw schema infers
// `event` as `unknown`).
export type { SDKPartialAssistantMessage }
export type SDKKeepAliveMessage = FromSchema<typeof SDKKeepAliveMessageSchema>
export type SDKUpdateEnvironmentVariablesMessage = FromSchema<typeof SDKUpdateEnvironmentVariablesMessageSchema>

/**
 * Outbound stream — mirrors StdoutMessageSchema, but composed from the typed
 * SDK message union so the placeholder overrides (message/event/uuid) from
 * coreTypes.generated.ts survive composition.
 */
export type StdoutMessage =
  | SDKMessage
  | SDKStreamlinedTextMessage
  | SDKStreamlinedToolUseSummaryMessage
  | SDKPostTurnSummaryMessage
  | SDKControlResponse
  | SDKControlRequest
  | SDKControlCancelRequest
  | SDKKeepAliveMessage

/** Inbound stream — mirrors StdinMessageSchema, composed from typed members. */
export type StdinMessage =
  | SDKUserMessage
  | SDKControlRequest
  | SDKControlResponse
  | SDKKeepAliveMessage
  | SDKUpdateEnvironmentVariablesMessage
