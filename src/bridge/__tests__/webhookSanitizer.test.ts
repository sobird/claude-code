import { describe, expect, test } from 'bun:test'

import type { ContentBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'

import { sanitizeInboundWebhookContent } from '../webhookSanitizer.js'

const OPEN = '<github-webhook-activity>'
const CLOSE = '</github-webhook-activity>'

function textBlock(text: string): TextBlockParam {
  return { type: 'text', text }
}

const imageBlock: ContentBlockParam = {
  type: 'image',
  source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' },
}

describe('sanitizeInboundWebhookContent', () => {
  test('leaves plain prose unchanged', () => {
    expect(sanitizeInboundWebhookContent('hello, please review my change')).toBe('hello, please review my change')
  })

  test('leaves empty and whitespace-only content unchanged', () => {
    expect(sanitizeInboundWebhookContent('')).toBe('')
    expect(sanitizeInboundWebhookContent('   ')).toBe('   ')
  })

  test('preserves the server-provided tag while redacting secrets inside it', () => {
    const input = `${OPEN}\nevent_type: review_comment\nrepo: owner/repo\ntoken=ghp_abcdefghijklmnopqrstuvwxyz0123456789\n${CLOSE}`
    const output = sanitizeInboundWebhookContent(input)

    expect(output.startsWith(OPEN)).toBe(true)
    expect(output).toContain('event_type: review_comment')
    expect(output).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(output).toContain('[REDACTED_GITHUB_TOKEN]')
  })

  test('redacts common credential formats', () => {
    const cases: Array<[string, string]> = [
      ['sk-ant-api03-abcdefghijklmnopqrstuvwxyz', '[REDACTED_ANTHROPIC_KEY]'],
      ['npm_abcdefghijklmnopqrstuvwxyz0123456789', '[REDACTED_NPM_TOKEN]'],
      ['xoxb-123456789012-abcdefghij', '[REDACTED_SLACK_TOKEN]'],
      ['AKIAABCDEFGHIJKLMNOP', '[REDACTED_AWS_KEY]'],
      ['Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789', '[REDACTED_TOKEN]'],
    ]
    for (const [secret, marker] of cases) {
      const output = sanitizeInboundWebhookContent(`fyi ${secret} fyi`)
      expect(output).toContain(marker)
      expect(output).not.toContain(secret)
    }
  })

  test('strips control characters but keeps newlines and tabs', () => {
    expect(sanitizeInboundWebhookContent('\u0000a\u0007b\tc\nd')).toBe('ab\tc\nd')
  })

  test('truncates oversized payloads', () => {
    const output = sanitizeInboundWebhookContent('x'.repeat(100_050))
    expect(output.length).toBeLessThan(100_050)
    expect(output.endsWith('\n... [truncated]')).toBe(true)
  })

  test('sanitizes text blocks without mutating the input array', () => {
    const first = textBlock('token=ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    const second = textBlock('plain')
    const input: Array<ContentBlockParam> = [first, second, imageBlock]

    const output = sanitizeInboundWebhookContent(input)

    expect(output).not.toBe(input)
    expect((output[0] as TextBlockParam).text).toBe('token=[REDACTED_GITHUB_TOKEN]')
    expect(output[1]).toBe(second)
    expect(output[2]).toBe(imageBlock)
    expect(first.text).toBe('token=ghp_abcdefghijklmnopqrstuvwxyz0123456789')
  })

  test('returns an array without text blocks unchanged', () => {
    const input: Array<ContentBlockParam> = [imageBlock]
    expect(sanitizeInboundWebhookContent(input)).toBe(input)
  })
})
