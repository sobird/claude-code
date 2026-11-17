/**
 * Image attachments shared by the composer, the gateway routes, and the reducer.
 *
 * Persisted user messages reference stored images by id instead of inlining base64:
 * `{ type: 'image', source: { type: 'attachment', attachment_id, media_type } }`.
 * Only the CLI delivery paths (`toClientPayload` / `toWorkerClientPayload`) turn a
 * reference into a base64 image block, so history and SSE stay small.
 */

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_MESSAGE = 5

const ALLOWED_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

export type AttachmentMediaType = (typeof ALLOWED_MEDIA_TYPES)[number]

/** A stored image reference as it appears in a persisted user message. */
export interface AttachmentRef {
  id: string
  mediaType: string
}

export function isAllowedAttachmentMediaType(value: unknown): value is AttachmentMediaType {
  return typeof value === 'string' && (ALLOWED_MEDIA_TYPES as readonly string[]).includes(value)
}

/** The Claude wire block that carries an attachment reference. */
export function attachmentBlock(ref: AttachmentRef): Record<string, unknown> {
  return {
    type: 'image',
    source: { type: 'attachment', attachment_id: ref.id, media_type: ref.mediaType },
  }
}

/**
 * Builds the `content` array sent to the CLI. Images lead (matching how the CLI
 * orders pasted images), then the text block when there is any.
 */
export function buildUserContent(text: string, attachments: AttachmentRef[]): Record<string, unknown>[] {
  const blocks = attachments.slice(0, MAX_ATTACHMENTS_PER_MESSAGE).map(attachmentBlock)
  if (text.trim()) blocks.push({ type: 'text', text })
  return blocks
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** Attachment ref out of an image block, or null for base64 blocks / other content. */
export function attachmentRefOfBlock(block: unknown): AttachmentRef | null {
  const record = asRecord(block)
  if (!record || record.type !== 'image') return null
  const source = asRecord(record.source)
  if (!source || source.type !== 'attachment') return null
  const id = source.attachment_id
  if (typeof id !== 'string' || !id) return null
  const mediaType = source.media_type ?? source.mediaType
  return { id, mediaType: typeof mediaType === 'string' ? mediaType : '' }
}

/**
 * Collects attachment references from a `user` event payload, whether the blocks
 * are on `content` (client sends) or `message.content` (bridge shape). Dedupes
 * by id so a repeated block never renders twice.
 */
export function extractUserAttachments(payload: unknown): AttachmentRef[] {
  const record = asRecord(payload)
  if (!record) return []
  const message = asRecord(record.message)
  const candidates = [record.content, message?.content]
  const seen = new Set<string>()
  const refs: AttachmentRef[] = []
  for (const content of candidates) {
    if (!Array.isArray(content)) continue
    for (const block of content) {
      const ref = attachmentRefOfBlock(block)
      if (!ref || seen.has(ref.id)) continue
      seen.add(ref.id)
      refs.push(ref)
    }
  }
  return refs
}
