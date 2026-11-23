import type { UUID } from 'node:crypto'

import type { Base64ImageSource, ContentBlockParam, ImageBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'

import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import { detectImageFormatFromBase64 } from '../utils/imageResizer.js'

/**
 * Process an inbound user message from the bridge, extracting content
 * and UUID for enqueueing. Supports both string content and
 * ContentBlockParam[] (e.g. messages containing images).
 *
 * Normalizes image blocks from bridge clients that may use camelCase
 * `mediaType` instead of snake_case `media_type` (mobile-apps#5825).
 *
 * Returns the extracted fields, or undefined if the message should be
 * skipped (non-user type, missing/empty content).
 */
export function extractInboundMessageFields(
  msg: SDKMessage,
): { content: string | Array<ContentBlockParam>; uuid: UUID | undefined } | undefined {
  if (msg.type !== 'user') return undefined
  const content = msg.message?.content
  if (!content) return undefined
  if (Array.isArray(content) && content.length === 0) return undefined

  const uuid = 'uuid' in msg && typeof msg.uuid === 'string' ? msg.uuid : undefined

  return {
    content: Array.isArray(content) ? normalizeImageBlocks(content) : content,
    uuid,
  }
}

/**
 * Normalize image content blocks from bridge clients. iOS/web clients may
 * send `mediaType` (camelCase) instead of `media_type` (snake_case), or
 * omit the field entirely. Without normalization, the bad block poisons
 * the session — every subsequent API call fails with
 * "media_type: Field required".
 *
 * Fast-path scan returns the original array reference when no
 * normalization is needed (zero allocation on the happy path).
 */
/**
 * 投递通道：`queue` 等本轮结束再当新 query 处理；`steer`（默认）在当前工具调用
 * 结束后、下一次 API 往返前注入。Web 端随事件 payload 携带。
 */
export type InboundDelivery = 'steer' | 'queue'

/**
 * 读取客户端附带的投递通道。旧客户端不带该字段，按插话处理以保持既有行为
 *（bridge 入站一直入队默认 `next` 优先级）。
 */
export function inboundDeliveryOf(msg: unknown): InboundDelivery {
  if (typeof msg !== 'object' || msg === null || !('delivery' in msg)) return 'steer'
  return typeof msg.delivery === 'string' && msg.delivery === 'queue' ? 'queue' : 'steer'
}

/** 把投递通道映射到 CLI 队列优先级。 */
export function queuePriorityOf(delivery: InboundDelivery): 'next' | 'later' {
  return delivery === 'queue' ? 'later' : 'next'
}

export function normalizeImageBlocks(blocks: Array<ContentBlockParam>): Array<ContentBlockParam> {
  if (!blocks.some(isMalformedBase64Image)) return blocks

  return blocks.map((block) => {
    if (!isMalformedBase64Image(block)) return block
    const src = block.source as unknown as Record<string, unknown>
    const mediaType =
      typeof src.mediaType === 'string' && src.mediaType
        ? src.mediaType
        : detectImageFormatFromBase64(block.source.data)
    return {
      ...block,
      source: {
        type: 'base64' as const,
        media_type: mediaType as Base64ImageSource['media_type'],
        data: block.source.data,
      },
    }
  })
}

function isMalformedBase64Image(block: ContentBlockParam): block is ImageBlockParam & { source: Base64ImageSource } {
  if (block.type !== 'image' || block.source?.type !== 'base64') return false
  return !(block.source as unknown as Record<string, unknown>).media_type
}
