/**
 * SDK core types, generated from the Zod schemas in coreSchemas.ts.
 *
 * coreSchemas.ts is the single source of truth for the wire protocol; this
 * file is its static mirror. The upstream generator applies a TypeOverrideMap
 * on top of `z.infer` to swap the runtime placeholders (APIUserMessage,
 * APIAssistantMessage, RawMessageStreamEvent, NonNullableUsage, UUID) for
 * their real TS types — the same overrides are applied below.
 */

import type { UUID } from 'node:crypto'

import type { BetaMessage, BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { z } from 'zod/v4'

import type {
  AccountInfoSchema,
  AgentDefinitionSchema,
  AgentInfoSchema,
  AgentMcpServerSpecSchema,
  ApiKeySourceSchema,
  AsyncHookJSONOutputSchema,
  ConfigChangeHookInputSchema,
  ConfigScopeSchema,
  CwdChangedHookInputSchema,
  ElicitationHookInputSchema,
  ElicitationResultHookInputSchema,
  FastModeStateSchema,
  FileChangedHookInputSchema,
  HookInputSchema,
  HookJSONOutputSchema,
  InstructionsLoadedHookInputSchema,
  McpClaudeAIProxyServerConfigSchema,
  McpHttpServerConfigSchema,
  McpSSEServerConfigSchema,
  McpSdkServerConfigSchema,
  McpServerConfigForProcessTransportSchema,
  McpServerStatusConfigSchema,
  McpServerStatusSchema,
  McpSetServersResultSchema,
  McpStdioServerConfigSchema,
  ModelInfoSchema,
  ModelUsageSchema,
  NotificationHookInputSchema,
  OutputFormatSchema,
  PermissionBehaviorSchema,
  PermissionDecisionClassificationSchema,
  PermissionDeniedHookInputSchema,
  PermissionModeSchema,
  PermissionRequestHookInputSchema,
  PermissionResultSchema,
  PermissionRuleValueSchema,
  PermissionUpdateDestinationSchema,
  PermissionUpdateSchema,
  PostCompactHookInputSchema,
  PostToolUseFailureHookInputSchema,
  PostToolUseHookInputSchema,
  PreCompactHookInputSchema,
  PreToolUseHookInputSchema,
  PromptRequestOptionSchema,
  PromptRequestSchema,
  PromptResponseSchema,
  RewindFilesResultSchema,
  SDKAPIRetryMessageSchema,
  SDKAssistantMessageErrorSchema,
  SDKAssistantMessageSchema,
  SDKAuthStatusMessageSchema,
  SDKCompactBoundaryMessageSchema,
  SDKElicitationCompleteMessageSchema,
  SDKFilesPersistedEventSchema,
  SDKHookProgressMessageSchema,
  SDKHookResponseMessageSchema,
  SDKHookStartedMessageSchema,
  SDKLocalCommandOutputMessageSchema,
  SDKPartialAssistantMessageSchema,
  SDKPermissionDenialSchema,
  SDKPostTurnSummaryMessageSchema,
  SDKPromptSuggestionMessageSchema,
  SDKRateLimitEventSchema,
  SDKRateLimitInfoSchema,
  SDKResultErrorSchema,
  SDKResultSuccessSchema,
  SDKSessionInfoSchema,
  SDKSessionStateChangedMessageSchema,
  SDKStatusMessageSchema,
  SDKStatusSchema,
  SDKStreamlinedTextMessageSchema,
  SDKStreamlinedToolUseSummaryMessageSchema,
  SDKSystemMessageSchema,
  SDKTaskNotificationMessageSchema,
  SDKTaskProgressMessageSchema,
  SDKTaskStartedMessageSchema,
  SDKToolProgressMessageSchema,
  SDKToolUseSummaryMessageSchema,
  SDKUserMessageReplaySchema,
  SDKUserMessageSchema,
  SdkBetaSchema,
  SdkPluginConfigSchema,
  SessionEndHookInputSchema,
  SessionStartHookInputSchema,
  SettingSourceSchema,
  SetupHookInputSchema,
  SlashCommandSchema,
  StopFailureHookInputSchema,
  StopHookInputSchema,
  SubagentStartHookInputSchema,
  SubagentStopHookInputSchema,
  SyncHookJSONOutputSchema,
  TaskCompletedHookInputSchema,
  TaskCreatedHookInputSchema,
  TeammateIdleHookInputSchema,
  ThinkingConfigSchema,
  UserPromptSubmitHookInputSchema,
} from './coreSchemas.js'
import type { NonNullableUsage } from './sdkUtilityTypes.js'

/** `lazySchema` wraps each schema in a memoized factory; infer from its product. */
type FromSchema<T extends () => z.ZodType> = z.infer<ReturnType<T>>

/** Replace fields whose schema is a runtime placeholder with their real TS type. */
type WithOverrides<T, O> = Omit<T, keyof O> & O

// Usage & Model
export type ModelUsage = FromSchema<typeof ModelUsageSchema>
export type ApiKeySource = FromSchema<typeof ApiKeySourceSchema>
export type ModelInfo = FromSchema<typeof ModelInfoSchema>
export type FastModeState = FromSchema<typeof FastModeStateSchema>

// MCP
export type McpStdioServerConfig = FromSchema<typeof McpStdioServerConfigSchema>
export type McpSSEServerConfig = FromSchema<typeof McpSSEServerConfigSchema>
export type McpHttpServerConfig = FromSchema<typeof McpHttpServerConfigSchema>
export type McpSdkServerConfig = FromSchema<typeof McpSdkServerConfigSchema>
export type McpClaudeAIProxyServerConfig = FromSchema<typeof McpClaudeAIProxyServerConfigSchema>
export type McpServerConfigForProcessTransport = FromSchema<typeof McpServerConfigForProcessTransportSchema>
export type McpServerStatusConfig = FromSchema<typeof McpServerStatusConfigSchema>
export type McpServerStatus = FromSchema<typeof McpServerStatusSchema>
export type McpSetServersResult = FromSchema<typeof McpSetServersResultSchema>

// Permissions
export type PermissionMode = FromSchema<typeof PermissionModeSchema>
export type PermissionBehavior = FromSchema<typeof PermissionBehaviorSchema>
export type PermissionUpdateDestination = FromSchema<typeof PermissionUpdateDestinationSchema>
export type PermissionUpdate = FromSchema<typeof PermissionUpdateSchema>
export type PermissionRuleValue = FromSchema<typeof PermissionRuleValueSchema>
export type PermissionDecisionClassification = FromSchema<typeof PermissionDecisionClassificationSchema>
export type PermissionResult = FromSchema<typeof PermissionResultSchema>

// Rewind
export type RewindFilesResult = FromSchema<typeof RewindFilesResultSchema>

// Account
export type AccountInfo = FromSchema<typeof AccountInfoSchema>

// Hooks
export type HookInput = FromSchema<typeof HookInputSchema>
export type HookJSONOutput = FromSchema<typeof HookJSONOutputSchema>
export type AsyncHookJSONOutput = FromSchema<typeof AsyncHookJSONOutputSchema>
export type SyncHookJSONOutput = FromSchema<typeof SyncHookJSONOutputSchema>

export type PreToolUseHookInput = FromSchema<typeof PreToolUseHookInputSchema>
export type PostToolUseHookInput = FromSchema<typeof PostToolUseHookInputSchema>
export type PostToolUseFailureHookInput = FromSchema<typeof PostToolUseFailureHookInputSchema>
export type PermissionRequestHookInput = FromSchema<typeof PermissionRequestHookInputSchema>
export type PermissionDeniedHookInput = FromSchema<typeof PermissionDeniedHookInputSchema>
export type NotificationHookInput = FromSchema<typeof NotificationHookInputSchema>
export type UserPromptSubmitHookInput = FromSchema<typeof UserPromptSubmitHookInputSchema>
export type SessionStartHookInput = FromSchema<typeof SessionStartHookInputSchema>
export type SessionEndHookInput = FromSchema<typeof SessionEndHookInputSchema>
export type SetupHookInput = FromSchema<typeof SetupHookInputSchema>
export type StopHookInput = FromSchema<typeof StopHookInputSchema>
export type StopFailureHookInput = FromSchema<typeof StopFailureHookInputSchema>
export type SubagentStartHookInput = FromSchema<typeof SubagentStartHookInputSchema>
export type SubagentStopHookInput = FromSchema<typeof SubagentStopHookInputSchema>
export type PreCompactHookInput = FromSchema<typeof PreCompactHookInputSchema>
export type PostCompactHookInput = FromSchema<typeof PostCompactHookInputSchema>
export type TeammateIdleHookInput = FromSchema<typeof TeammateIdleHookInputSchema>
export type TaskCreatedHookInput = FromSchema<typeof TaskCreatedHookInputSchema>
export type TaskCompletedHookInput = FromSchema<typeof TaskCompletedHookInputSchema>
export type ElicitationHookInput = FromSchema<typeof ElicitationHookInputSchema>
export type ElicitationResultHookInput = FromSchema<typeof ElicitationResultHookInputSchema>
export type ConfigChangeHookInput = FromSchema<typeof ConfigChangeHookInputSchema>
export type InstructionsLoadedHookInput = FromSchema<typeof InstructionsLoadedHookInputSchema>
export type CwdChangedHookInput = FromSchema<typeof CwdChangedHookInputSchema>
export type FileChangedHookInput = FromSchema<typeof FileChangedHookInputSchema>

// Shared protocol types
export type ConfigScope = FromSchema<typeof ConfigScopeSchema>
export type OutputFormat = FromSchema<typeof OutputFormatSchema>
export type SdkBeta = FromSchema<typeof SdkBetaSchema>
export type ThinkingConfig = FromSchema<typeof ThinkingConfigSchema>
export type SlashCommand = FromSchema<typeof SlashCommandSchema>
export type AgentInfo = FromSchema<typeof AgentInfoSchema>
export type AgentMcpServerSpec = FromSchema<typeof AgentMcpServerSpecSchema>
export type AgentDefinition = FromSchema<typeof AgentDefinitionSchema>
export type SettingSource = FromSchema<typeof SettingSourceSchema>
export type SdkPluginConfig = FromSchema<typeof SdkPluginConfigSchema>
export type PromptRequestOption = FromSchema<typeof PromptRequestOptionSchema>
export type PromptRequest = FromSchema<typeof PromptRequestSchema>
export type PromptResponse = FromSchema<typeof PromptResponseSchema>
export type SDKSessionInfo = FromSchema<typeof SDKSessionInfoSchema>
export type SDKStatus = FromSchema<typeof SDKStatusSchema>
export type SDKAssistantMessageError = FromSchema<typeof SDKAssistantMessageErrorSchema>

/** Not present in coreSchemas.ts (no wire representation); kept for API compatibility. */
export type SDKAssistantErrorMessage = { type: 'assistant_error'; error: unknown; [key: string]: unknown }

// SDK messages
export type SDKUserMessage = WithOverrides<
  FromSchema<typeof SDKUserMessageSchema>,
  { message: MessageParam; uuid?: UUID }
>
export type SDKUserMessageReplay = WithOverrides<
  FromSchema<typeof SDKUserMessageReplaySchema>,
  { message: MessageParam; uuid: UUID }
>
export type SDKAssistantMessage = WithOverrides<
  FromSchema<typeof SDKAssistantMessageSchema>,
  { message: BetaMessage; uuid: UUID }
>
export type SDKPartialAssistantMessage = WithOverrides<
  FromSchema<typeof SDKPartialAssistantMessageSchema>,
  { event: BetaRawMessageStreamEvent; uuid: UUID }
>
export type SDKPermissionDenial = FromSchema<typeof SDKPermissionDenialSchema>
export type SDKRateLimitInfo = FromSchema<typeof SDKRateLimitInfoSchema>
export type SDKRateLimitEvent = WithOverrides<FromSchema<typeof SDKRateLimitEventSchema>, { uuid: UUID }>
export type SDKResultSuccess = WithOverrides<
  FromSchema<typeof SDKResultSuccessSchema>,
  { usage: NonNullableUsage; uuid: UUID }
>
export type SDKResultError = WithOverrides<
  FromSchema<typeof SDKResultErrorSchema>,
  { usage: NonNullableUsage; uuid: UUID }
>
export type SDKResultMessage = SDKResultSuccess | SDKResultError
export type SDKSystemMessage = WithOverrides<FromSchema<typeof SDKSystemMessageSchema>, { uuid: UUID }>
export type SDKStatusMessage = WithOverrides<FromSchema<typeof SDKStatusMessageSchema>, { uuid: UUID }>
type SDKCompactBoundaryShape = FromSchema<typeof SDKCompactBoundaryMessageSchema>
type SDKCompactMetadataShape = SDKCompactBoundaryShape['compact_metadata']
type SDKPreservedSegmentShape = NonNullable<SDKCompactMetadataShape['preserved_segment']>

/** The wire schema models UUIDs as strings; the generator's override map
 * swaps the `UUIDPlaceholder` runtime stand-ins for the real `UUID` type, so
 * mirror that for the nested preserved_segment ids too. */
export type SDKCompactBoundaryMessage = WithOverrides<
  SDKCompactBoundaryShape,
  {
    uuid: UUID
    compact_metadata: WithOverrides<
      SDKCompactMetadataShape,
      {
        preserved_segment?: WithOverrides<
          SDKPreservedSegmentShape,
          { head_uuid: UUID; anchor_uuid: UUID; tail_uuid: UUID }
        >
      }
    >
  }
>
export type SDKToolProgressMessage = WithOverrides<FromSchema<typeof SDKToolProgressMessageSchema>, { uuid: UUID }>
export type SDKAPIRetryMessage = WithOverrides<FromSchema<typeof SDKAPIRetryMessageSchema>, { uuid: UUID }>
export type SDKLocalCommandOutputMessage = WithOverrides<
  FromSchema<typeof SDKLocalCommandOutputMessageSchema>,
  { uuid: UUID }
>
export type SDKHookStartedMessage = WithOverrides<FromSchema<typeof SDKHookStartedMessageSchema>, { uuid: UUID }>
export type SDKHookProgressMessage = WithOverrides<FromSchema<typeof SDKHookProgressMessageSchema>, { uuid: UUID }>
export type SDKHookResponseMessage = WithOverrides<FromSchema<typeof SDKHookResponseMessageSchema>, { uuid: UUID }>
export type SDKAuthStatusMessage = WithOverrides<FromSchema<typeof SDKAuthStatusMessageSchema>, { uuid: UUID }>
export type SDKTaskNotificationMessage = WithOverrides<
  FromSchema<typeof SDKTaskNotificationMessageSchema>,
  { uuid: UUID }
>
export type SDKTaskStartedMessage = WithOverrides<FromSchema<typeof SDKTaskStartedMessageSchema>, { uuid: UUID }>
export type SDKTaskProgressMessage = WithOverrides<FromSchema<typeof SDKTaskProgressMessageSchema>, { uuid: UUID }>
export type SDKSessionStateChangedMessage = WithOverrides<
  FromSchema<typeof SDKSessionStateChangedMessageSchema>,
  { uuid: UUID }
>
export type SDKFilesPersistedEvent = WithOverrides<FromSchema<typeof SDKFilesPersistedEventSchema>, { uuid: UUID }>
export type SDKToolUseSummaryMessage = WithOverrides<FromSchema<typeof SDKToolUseSummaryMessageSchema>, { uuid: UUID }>
export type SDKElicitationCompleteMessage = WithOverrides<
  FromSchema<typeof SDKElicitationCompleteMessageSchema>,
  { uuid: UUID }
>
export type SDKPromptSuggestionMessage = WithOverrides<
  FromSchema<typeof SDKPromptSuggestionMessageSchema>,
  { uuid: UUID }
>
export type SDKPostTurnSummaryMessage = WithOverrides<
  FromSchema<typeof SDKPostTurnSummaryMessageSchema>,
  { uuid: UUID }
>
export type SDKStreamlinedTextMessage = WithOverrides<
  FromSchema<typeof SDKStreamlinedTextMessageSchema>,
  { uuid: UUID }
>
export type SDKStreamlinedToolUseSummaryMessage = WithOverrides<
  FromSchema<typeof SDKStreamlinedToolUseSummaryMessageSchema>,
  { uuid: UUID }
>

/** Union of every message the CLI can emit — mirrors SDKMessageSchema in coreSchemas.ts. */
export type SDKMessage =
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKUserMessageReplay
  | SDKResultMessage
  | SDKSystemMessage
  | SDKPartialAssistantMessage
  | SDKCompactBoundaryMessage
  | SDKStatusMessage
  | SDKAPIRetryMessage
  | SDKLocalCommandOutputMessage
  | SDKHookStartedMessage
  | SDKHookProgressMessage
  | SDKHookResponseMessage
  | SDKToolProgressMessage
  | SDKAuthStatusMessage
  | SDKTaskNotificationMessage
  | SDKTaskStartedMessage
  | SDKTaskProgressMessage
  | SDKSessionStateChangedMessage
  | SDKFilesPersistedEvent
  | SDKToolUseSummaryMessage
  | SDKRateLimitEvent
  | SDKElicitationCompleteMessage
  | SDKPromptSuggestionMessage
