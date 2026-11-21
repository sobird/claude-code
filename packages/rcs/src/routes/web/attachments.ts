/**
 * Web attachment routes.
 *
 * `POST /web/attachments` takes a raw image body (no multipart), dedupes by
 * `(owner, sha256)`, and returns the `att_…` reference that user messages embed.
 * `GET /web/attachments/:id` serves the bytes with a long-lived private cache;
 * the client appends no token, so the browser sends the auth cookie/header.
 */

import { Hono } from 'hono'

import type { AppContext, AppEnv } from '@/auth/context'
import { MAX_ATTACHMENT_BYTES, isAllowedAttachmentMediaType } from '@/lib/attachments'
import { jsonError, legacyUserAuth } from '@/routes/common'

const app = new Hono<AppEnv>()

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function tooLarge(c: AppContext) {
  return jsonError(c, 'payload_too_large', 'Image exceeds the size limit', 413, 'attachment_too_large')
}

/** POST /web/attachments — Upload one image, returning its stored reference. */
app.post('/attachments', legacyUserAuth, async (c) => {
  const contentType = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (!isAllowedAttachmentMediaType(contentType)) {
    return jsonError(
      c,
      'unsupported_media_type',
      'Only PNG, JPEG, GIF, or WebP images are accepted',
      415,
      'attachment_unsupported_type',
    )
  }

  const declared = Number.parseInt(c.req.header('content-length') ?? '', 10)
  if (Number.isFinite(declared) && declared > MAX_ATTACHMENT_BYTES) return tooLarge(c)

  const body = await c.req.arrayBuffer()
  if (body.byteLength === 0) return jsonError(c, 'invalid_request', 'Empty body', 400, 'attachment_empty')
  if (body.byteLength > MAX_ATTACHMENT_BYTES) return tooLarge(c)

  const record = await c.get('repos').attachments.createOrGet({
    ownerUserId: c.get('user').id,
    mediaType: contentType,
    sha256: toHex(await crypto.subtle.digest('SHA-256', body)),
    byteLength: body.byteLength,
    data: new Uint8Array(body),
  })
  return c.json({ id: record.id, media_type: record.mediaType, byte_length: record.byteLength }, 200)
})

/** GET /web/attachments/:id — Serve an attachment the caller may see. */
app.get('/attachments/:id', legacyUserAuth, async (c) => {
  const record = await c.get('repos').attachments.getById(c.req.param('id'))
  if (!record) return jsonError(c, 'not_found', 'Attachment not found', 404, 'attachment_not_found')
  const user = c.get('user')
  if (record.ownerUserId !== user.id && user.role !== 'admin') {
    return jsonError(c, 'forbidden', 'Not your attachment', 403, 'forbidden')
  }

  const etag = `"${record.sha256}"`
  const headers = {
    'Content-Type': record.mediaType,
    'Cache-Control': 'private, max-age=31536000, immutable',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  }
  if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304, headers })
  return new Response(new Uint8Array(record.data), { status: 200, headers })
})

export default app
