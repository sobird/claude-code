import { describe, expect, test } from 'bun:test'

import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  attachmentBlock,
  buildUserContent,
  extractUserAttachments,
  isAllowedAttachmentMediaType,
} from '../attachments'

describe('isAllowedAttachmentMediaType', () => {
  test('accepts the four supported image types', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(isAllowedAttachmentMediaType(type)).toBe(true)
    }
  })

  test('rejects anything else', () => {
    for (const value of ['application/pdf', 'image/svg+xml', '', null, undefined, 42]) {
      expect(isAllowedAttachmentMediaType(value)).toBe(false)
    }
  })
})

describe('attachmentBlock', () => {
  test('produces an image block with an attachment source', () => {
    expect(attachmentBlock({ id: 'att_1', mediaType: 'image/png' })).toEqual({
      type: 'image',
      source: { type: 'attachment', attachment_id: 'att_1', media_type: 'image/png' },
    })
  })
})

describe('buildUserContent', () => {
  test('text only yields a single text block', () => {
    expect(buildUserContent('hello', [])).toEqual([{ type: 'text', text: 'hello' }])
  })

  test('images come before the text block', () => {
    const refs = [
      { id: 'att_1', mediaType: 'image/png' },
      { id: 'att_2', mediaType: 'image/jpeg' },
    ]
    expect(buildUserContent('look', refs)).toEqual([
      attachmentBlock(refs[0]),
      attachmentBlock(refs[1]),
      { type: 'text', text: 'look' },
    ])
  })

  test('image-only sends carry no empty text block', () => {
    expect(buildUserContent('   ', [{ id: 'att_1', mediaType: 'image/png' }])).toEqual([
      attachmentBlock({ id: 'att_1', mediaType: 'image/png' }),
    ])
  })

  test('caps the number of attachments', () => {
    const refs = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 3 }, (_, i) => ({
      id: `att_${i}`,
      mediaType: 'image/png',
    }))
    expect(buildUserContent('x', refs)).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE + 1)
  })

  test('does not mutate the input refs', () => {
    const refs = [{ id: 'att_1', mediaType: 'image/png' }]
    buildUserContent('x', refs)
    expect(refs).toEqual([{ id: 'att_1', mediaType: 'image/png' }])
  })
})

describe('extractUserAttachments', () => {
  const block = attachmentBlock({ id: 'att_1', mediaType: 'image/png' })

  test('reads attachment refs from a flat content array', () => {
    expect(extractUserAttachments({ content: [block, { type: 'text', text: 'hi' }] })).toEqual([
      { id: 'att_1', mediaType: 'image/png' },
    ])
  })

  test('reads attachment refs from message.content with camelCase mediaType', () => {
    expect(
      extractUserAttachments({
        message: {
          role: 'user',
          content: [{ type: 'image', source: { type: 'attachment', attachment_id: 'att_2', mediaType: 'image/webp' } }],
        },
      }),
    ).toEqual([{ id: 'att_2', mediaType: 'image/webp' }])
  })

  test('ignores hydrated base64 images and non-image blocks', () => {
    expect(
      extractUserAttachments({
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          { type: 'text', text: 'hi' },
          { type: 'image', source: { type: 'attachment', media_type: 'image/png' } },
        ],
      }),
    ).toEqual([])
  })

  test('dedupes repeated refs and tolerates malformed payloads', () => {
    expect(extractUserAttachments({ content: [block, block] })).toEqual([{ id: 'att_1', mediaType: 'image/png' }])
    expect(extractUserAttachments(undefined)).toEqual([])
    expect(extractUserAttachments('hello')).toEqual([])
    expect(extractUserAttachments({ content: 'plain text' })).toEqual([])
  })
})
