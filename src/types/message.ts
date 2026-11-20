import type { UUID } from 'node:crypto'

import type { APIError } from '@anthropic-ai/sdk'
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaRawMessageStreamEvent,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ContentBlock, ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'

import type { SDKAssistantMessageError } from '../entrypoints/sdk/coreTypes.generated.js'
import type { BranchAction, CommitKind, PrAction } from '../tools/shared/gitOperationTracking.js'
import type { Attachment } from '../utils/attachments.js'
import type { HookProgress } from './hooks.js'
import type { ToolProgressData } from './tools.js'

/**
 * Discriminant values carried by every renderable/storable transcript entry.
 * `stream_event` / `stream_request_start` are transient stream markers handled
 * by `StreamEvent` / `RequestStartEvent`, not by `Message`.
 */
export type MessageType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'attachment'
  | 'progress'
  | 'grouped_tool_use'
  | 'collapsed_read_search'
  | 'tombstone'
  | 'tool_use_summary'

/** A single content element inside a message content array. */
export type ContentItem = BetaContentBlock | BetaContentBlockParam | ContentBlock | ContentBlockParam

/** An array of content blocks — the shape `message.content` takes once stored. */
export type MessageContent = ContentItem[]

/** Typed content array — used in narrowed message subtypes. */
export type TypedMessageContent = ContentItem[]

/**
 * Provenance of a message. Stamped onto UserMessages so the transcript records
 * origin structurally (not just via XML tags in content). undefined = human.
 */
export type MessageOrigin =
  | { kind: 'human' }
  | { kind: 'channel'; server: string }
  | { kind: 'coordinator' }
  | { kind: 'task-notification' }
  | { kind: 'cross-session' }

/** Metadata attached to a compact boundary message. */
export type CompactMetadata = {
  trigger: 'manual' | 'auto'
  preTokens: number
  preCompactDiscoveredTools?: string[]
  preservedSegment?: {
    headUuid: UUID
    tailUuid: UUID
    anchorUuid: UUID
    [key: string]: unknown
  }
  [key: string]: unknown
}

/** Metadata attached to a microcompact boundary message. */
export type MicrocompactMetadata = {
  trigger: 'auto'
  preTokens: number
  tokensSaved: number
  compactedToolIds: string[]
  clearedAttachmentUUIDs: string[]
  [key: string]: unknown
}

export type StopHookInfo = {
  command?: string
  promptText?: string
  durationMs?: number
  [key: string]: unknown
}

/**
 * The inner Anthropic API message payload nested under an assistant message.
 * This is the beta Messages API response shape (the CLI targets the beta
 * endpoint, so content blocks are `BetaContentBlock`s).
 */
export type APIAssistantMessage = BetaMessage

/** The inner Anthropic API message payload nested under a user message. */
export type APIUserMessage = {
  role: 'user'
  content: string | ContentBlockParam[]
  [key: string]: unknown
}

/** Union of the inner API message payloads, discriminated by `role`. */
export type APIMessage = APIAssistantMessage | APIUserMessage

/**
 * Fields shared by every message variant. Variants add their own discriminant
 * plus the payload that is only meaningful for that kind of message.
 */
type MessageBase = {
  uuid: UUID
  timestamp: string
  origin?: MessageOrigin
  toolUseResult?: unknown
  [key: string]: unknown
}

export type AssistantMessage = MessageBase & {
  type: 'assistant'
  message: APIAssistantMessage
  requestId?: string
  isApiErrorMessage?: boolean
  apiError?: string
  error?: SDKAssistantMessageError
  errorDetails?: string
  isVirtual?: true
  isMeta?: true
  isVisibleInTranscriptOnly?: true
  /** Advisor model that contributed to this reply, when the advisor tool is enabled. */
  advisorModel?: string
}

type UserMessageFields = {
  type: 'user'
  isMeta?: true
  isVisibleInTranscriptOnly?: true
  isVirtual?: true
  isCompactSummary?: boolean
  mcpMeta?: {
    _meta?: Record<string, unknown>
    structuredContent?: Record<string, unknown>
  }
  imagePasteIds?: number[]
  sourceToolUseID?: string
  sourceToolAssistantUUID?: UUID
  permissionMode?: string
  /** Plan text attached to a user message emitted when plan mode is exited. */
  planContent?: string
  summarizeMetadata?: {
    messagesSummarized: number
    userContext?: string
    direction?: PartialCompactDirection
  }
}

/** Raw user message — content may still be a plain string before normalization. */
export type UserMessage = MessageBase &
  UserMessageFields & {
    message: APIUserMessage
  }

/** User message after `normalizeMessages` — content is always a block array. */
export type NormalizedUserMessage = MessageBase &
  UserMessageFields & {
    message: APIUserMessage & { content: ContentBlockParam[] }
  }

/** Payload carried by attachment messages; `type` selects the attachment kind. */
export type AttachmentPayload<T = Attachment> = {
  type: string
  toolUseID?: string
} & T

export type AttachmentMessage<T = Attachment> = MessageBase & {
  type: 'attachment'
  attachment: AttachmentPayload<T>
}

export type ProgressMessage<T = ToolProgressData> = MessageBase & {
  type: 'progress'
  data: T
  toolUseID: string
  parentToolUseID: string
}

/**
 * Fields shared by every system message regardless of subtype: the text
 * payload, severity and synthetic flag are read from the un-narrowed union
 * (e.g. the SystemTextMessage fallback branch). Everything else is declared
 * on the arm that owns it so narrowing exposes it without casts.
 */
type SystemMessageBase = MessageBase & {
  type: 'system'
  content?: string
  level?: SystemMessageLevel
  isMeta?: boolean
}

export type SystemInformationalMessage = SystemMessageBase & {
  subtype: 'informational'
  toolUseID?: string
  preventContinuation?: boolean
}
export type SystemPermissionRetryMessage = SystemMessageBase & { subtype: 'permission_retry'; commands: string[] }
export type SystemBridgeStatusMessage = SystemMessageBase & {
  subtype: 'bridge_status'
  url: string
  upgradeNudge?: string
}
export type SystemScheduledTaskFireMessage = SystemMessageBase & { subtype: 'scheduled_task_fire' }
export type SystemStopHookSummaryMessage = SystemMessageBase & {
  subtype: 'stop_hook_summary'
  hookCount: number
  hookInfos: StopHookInfo[]
  hookErrors: string[]
  hookLabel?: string
  totalDurationMs?: number
  preventedContinuation?: boolean
  stopReason?: string
  hasOutput?: boolean
  toolUseID?: string
}
export type SystemTurnDurationMessage = SystemMessageBase & {
  subtype: 'turn_duration'
  durationMs: number
  budgetTokens?: number
  budgetLimit?: number
  budgetNudges?: number
  messageCount?: number
}
export type SystemAwaySummaryMessage = SystemMessageBase & { subtype: 'away_summary' }
export type SystemMemorySavedMessage = SystemMessageBase & {
  subtype: 'memory_saved'
  writtenPaths: string[]
  /** Number of team memories written, surfaced by the memory-saved UI. */
  teamCount?: number
  verb?: string
}
export type SystemAgentsKilledMessage = SystemMessageBase & { subtype: 'agents_killed' }
export type SystemApiMetricsMessage = SystemMessageBase & {
  subtype: 'api_metrics'
  ttftMs: number
  otps: number
  isP50?: boolean
  hookDurationMs?: number
  turnDurationMs?: number
  toolDurationMs?: number
  classifierDurationMs?: number
  toolCount?: number
  hookCount?: number
  classifierCount?: number
  configWriteCount?: number
}
export type SystemLocalCommandMessage = SystemMessageBase & { subtype: 'local_command'; content: string }
export type SystemCompactBoundaryMessage = SystemMessageBase & {
  subtype: 'compact_boundary'
  compactMetadata: CompactMetadata
  logicalParentUuid?: UUID | null
}
export type SystemMicrocompactBoundaryMessage = SystemMessageBase & {
  subtype: 'microcompact_boundary'
  microcompactMetadata: MicrocompactMetadata
}
export type SystemAPIErrorMessage = SystemMessageBase & {
  subtype: 'api_error'
  retryAttempt: number
  retryInMs: number
  maxRetries: number
  error: APIError
  cause?: Error
}
export type SystemFileSnapshotMessage = SystemMessageBase & {
  subtype: 'file_snapshot'
  snapshotFiles: { key: string; path: string; content: string }[]
}
/** Snip payload lives on the arm; literal kept for narrowing. */
export type SystemSnipBoundaryMessage = SystemMessageBase & {
  subtype: 'snip_boundary'
  snipMetadata?: { removedUuids?: string[]; tokensFreed?: number }
}
export type SystemSnipMarkerMessage = SystemMessageBase & {
  subtype: 'snip_marker'
  snipMarker?: { removedUuids?: string[] }
}
export type SystemThinkingMessage = SystemMessageBase & { subtype: 'thinking' }

export type SystemMessage =
  | SystemInformationalMessage
  | SystemPermissionRetryMessage
  | SystemBridgeStatusMessage
  | SystemScheduledTaskFireMessage
  | SystemStopHookSummaryMessage
  | SystemTurnDurationMessage
  | SystemAwaySummaryMessage
  | SystemMemorySavedMessage
  | SystemAgentsKilledMessage
  | SystemApiMetricsMessage
  | SystemLocalCommandMessage
  | SystemCompactBoundaryMessage
  | SystemMicrocompactBoundaryMessage
  | SystemAPIErrorMessage
  | SystemFileSnapshotMessage
  | SystemSnipBoundaryMessage
  | SystemSnipMarkerMessage
  | SystemThinkingMessage

export type GroupedToolUseMessage = MessageBase & {
  type: 'grouped_tool_use'
  toolName: string
  messages: NormalizedAssistantMessage<BetaToolUseBlock>[]
  results: NormalizedUserMessage[]
  displayMessage: NormalizedAssistantMessage | NormalizedUserMessage
}

export type CollapsedReadSearchGroup = {
  type: 'collapsed_read_search'
  uuid: UUID
  timestamp?: unknown
  searchCount: number
  readCount: number
  listCount: number
  replCount: number
  memorySearchCount: number
  memoryReadCount: number
  memoryWriteCount: number
  readFilePaths: string[]
  searchArgs: string[]
  latestDisplayHint?: string
  messages: CollapsibleMessage[]
  displayMessage: CollapsibleMessage
  mcpCallCount?: number
  mcpServerNames?: string[]
  bashCount?: number
  gitOpBashCount?: number
  commits?: { sha: string; kind: CommitKind }[]
  pushes?: { branch: string }[]
  branches?: { ref: string; action: BranchAction }[]
  prs?: { number: number; url?: string; action: PrAction }[]
  hookTotalMs?: number
  hookCount?: number
  hookInfos?: StopHookInfo[]
  relevantMemories?: { path: string; content: string; mtimeMs: number }[]
  teamMemorySearchCount?: number
  teamMemoryReadCount?: number
  teamMemoryWriteCount?: number
  [key: string]: unknown
}

/** Control signal telling consumers to drop the referenced message. */
export type TombstoneMessage = MessageBase & {
  type: 'tombstone'
  message: Message
}

/** SDK-only summary produced after a turn's tool uses complete. */
export type ToolUseSummaryMessage = MessageBase & {
  type: 'tool_use_summary'
  summary: string
  precedingToolUseIds: string[]
}

export type Message =
  | AssistantMessage
  | UserMessage
  | SystemMessage
  | AttachmentMessage
  | ProgressMessage
  | GroupedToolUseMessage
  | CollapsedReadSearchGroup
  | TombstoneMessage
  | ToolUseSummaryMessage

/**
 * Assistant message whose leading content block is narrowed to `T`.
 * `normalizeMessages` guarantees a single content block per stored message, so
 * the first block is the discriminated one callers switch on.
 */
export type NormalizedAssistantMessage<T = BetaContentBlock> = AssistantMessage & {
  message: APIAssistantMessage & { content: [T, ...BetaContentBlock[]] }
}

/** Stored/deduped messages (excludes control signals and UI-only groups). */
export type NormalizedMessage =
  | AssistantMessage
  | NormalizedUserMessage
  | SystemMessage
  | AttachmentMessage
  | ProgressMessage

/** Messages that the transcript UI can render as their own row. */
export type RenderableMessage =
  | AssistantMessage
  | NormalizedUserMessage
  | SystemMessage
  | AttachmentMessage
  | GroupedToolUseMessage
  | CollapsedReadSearchGroup

export type CollapsibleMessage = AssistantMessage | NormalizedUserMessage | GroupedToolUseMessage

/** Transient marker emitted before an API request starts. */
export type RequestStartEvent = {
  type: 'stream_request_start'
}

/** A partial streaming event forwarded from the Anthropic API. */
export type StreamEvent = {
  type: 'stream_event'
  event: BetaRawMessageStreamEvent
  uuid?: UUID
  session_id?: string
  parent_tool_use_id?: string | null
  ttftMs?: number
  [key: string]: unknown
}

/** Message a hook run can surface: an attachment (outcome) or progress ticks. */
export type HookResultMessage = AttachmentMessage | ProgressMessage<HookProgress>
export type PartialCompactDirection = string
export type SystemMessageLevel = string
