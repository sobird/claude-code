import type { UUID } from 'node:crypto'

import type { APIError } from '@anthropic-ai/sdk'
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaRawMessageStreamEvent,
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
  timestamp?: string
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

export type SystemMessage = MessageBase & {
  type: 'system'
  subtype?: string
  content?: string
  level?: SystemMessageLevel
  isMeta?: boolean
  commands?: string[]
  url?: string
  upgradeNudge?: string
  durationMs?: number
  budgetTokens?: number
  budgetLimit?: number
  budgetNudges?: number
  messageCount?: number
  writtenPaths?: string[]
  /** Number of team memories written, surfaced by the memory-saved UI. */
  teamCount?: number
  ttftMs?: number
  otps?: number
  isP50?: boolean
  hookDurationMs?: number
  turnDurationMs?: number
  toolDurationMs?: number
  compactMetadata?: CompactMetadata
  microcompactMetadata?: MicrocompactMetadata
  snapshotFiles?: { key: string; path: string; content: string }[]
  hookLabel?: string
  hookCount?: number
  hookInfos?: StopHookInfo[]
  hookErrors?: string[]
  totalDurationMs?: number
  verb?: string
  preventContinuation?: boolean
  logicalParentUuid?: UUID
  toolUseID?: string
  cause?: Error
  error?: unknown
}

export type GroupedToolUseMessage = MessageBase & {
  type: 'grouped_tool_use'
  toolName: string
  messages: NormalizedAssistantMessage[]
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

// ---- Narrow aliases kept for call sites that name a specific system kind ----

export type SystemLocalCommandMessage = SystemMessage & {
  subtype: 'local_command'
  content: string
}
export type SystemCompactBoundaryMessage = SystemMessage & { compactMetadata: CompactMetadata }
export type SystemAPIErrorMessage = SystemMessage & {
  retryAttempt: number
  retryInMs: number
  maxRetries: number
  error: APIError
}
export type SystemFileSnapshotMessage = SystemMessage & {
  snapshotFiles: { key: string; path: string; content: string }[]
}
export type SystemAgentsKilledMessage = SystemMessage
export type SystemApiMetricsMessage = SystemMessage
export type SystemAwaySummaryMessage = SystemMessage
export type SystemBridgeStatusMessage = SystemMessage & {
  subtype: 'bridge_status'
  url: string
  upgradeNudge?: string
}
export type SystemInformationalMessage = SystemMessage
export type SystemMemorySavedMessage = SystemMessage & {
  subtype: 'memory_saved'
  writtenPaths: string[]
}
export type SystemMicrocompactBoundaryMessage = SystemMessage
export type SystemPermissionRetryMessage = SystemMessage
export type SystemScheduledTaskFireMessage = SystemMessage
export type SystemStopHookSummaryMessage = SystemMessage & {
  subtype: 'stop_hook_summary'
  hookLabel?: string
  hookCount: number
  hookInfos: StopHookInfo[]
  hookErrors: string[]
  totalDurationMs?: number
  preventedContinuation?: boolean
  stopReason?: string
  hasOutput?: boolean
}
export type SystemTurnDurationMessage = SystemMessage
export type SystemThinkingMessage = SystemMessage

/** Message a hook run can surface: an attachment (outcome) or progress ticks. */
export type HookResultMessage = AttachmentMessage | ProgressMessage<HookProgress>
export type PartialCompactDirection = string
export type SystemMessageLevel = string
