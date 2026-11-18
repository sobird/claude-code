import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'

/**
 * Sanitize inbound bridge content before it is enqueued as user input.
 *
 * The server tags webhook activity with `<github-webhook-activity>` before
 * delivery; this module must preserve that tag so the UI can route it, while
 * stripping credentials and terminal-hostile bytes from the payload.
 *
 * Secrets are redacted before truncation so a token is never split across the
 * truncation boundary. Must never throw.
 */

const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // GitHub tokens (PAT, OAuth, App, server-to-server)
  {
    pattern: /\b(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{10,}\b/g,
    replacement: '[REDACTED_GITHUB_TOKEN]',
  },
  // Anthropic API keys
  {
    pattern: /\bsk-ant-[A-Za-z0-9_-]{10,}\b/g,
    replacement: '[REDACTED_ANTHROPIC_KEY]',
  },
  // Generic bearer tokens
  {
    pattern: /(Bearer\s+)[A-Za-z0-9._\-/+=]{20,}/gi,
    replacement: '$1[REDACTED_TOKEN]',
  },
  // AWS access keys
  {
    pattern: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replacement: '[REDACTED_AWS_KEY]',
  },
  // AWS secret keys after common labels
  {
    pattern: /(aws_secret_access_key|secret_key|SecretAccessKey)['":\s=]+[A-Za-z0-9/+=]{30,}/gi,
    replacement: '$1=[REDACTED_AWS_SECRET]',
  },
  // Generic key=value / "key": "value" credentials
  {
    pattern: /(api[_-]?key|apikey|secret|password|token|credential)['":\s=]+["']?[A-Za-z0-9._\-/+=]{16,}["']?/gi,
    replacement: '$1=[REDACTED]',
  },
  // npm tokens
  { pattern: /\bnpm_[A-Za-z0-9]{36}\b/g, replacement: '[REDACTED_NPM_TOKEN]' },
  // Slack tokens
  {
    pattern: /\bxox[bporas]-[A-Za-z0-9-]{10,}\b/g,
    replacement: '[REDACTED_SLACK_TOKEN]',
  },
]

/** Maximum content length before truncation (100KB). */
const MAX_CONTENT_LENGTH = 100_000

// Strip C0 control characters that can corrupt the terminal/UI, while
// preserving tab, newline and carriage return.
// eslint-disable-next-line no-control-regex -- matching control chars is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

const SANITIZE_ERROR_PLACEHOLDER = '[webhook content redacted due to sanitization error]'

export function sanitizeInboundWebhookContent(content: string): string
export function sanitizeInboundWebhookContent(content: Array<ContentBlockParam>): Array<ContentBlockParam>
export function sanitizeInboundWebhookContent(
  content: string | Array<ContentBlockParam>,
): string | Array<ContentBlockParam>
export function sanitizeInboundWebhookContent(
  content: string | Array<ContentBlockParam>,
): string | Array<ContentBlockParam> {
  if (typeof content === 'string') {
    try {
      return sanitizeText(content)
    } catch {
      return SANITIZE_ERROR_PLACEHOLDER
    }
  }

  if (!content.some((block) => block.type === 'text')) {
    return content
  }

  try {
    return content.map((block) => {
      if (block.type !== 'text') {
        return block
      }
      const text = sanitizeText(block.text)
      // Preserve the original block reference when nothing was redacted so
      // untouched content stays cheap to compare/dedupe upstream.
      return text === block.text ? block : { ...block, text }
    })
  } catch {
    // An array has no safe placeholder shape; leave it untouched rather than
    // injecting a non-text block the API would reject.
    return content
  }
}

function sanitizeText(text: string): string {
  if (!text) {
    return text
  }

  let sanitized = text.replace(CONTROL_CHARS, '')

  for (const { pattern, replacement } of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    sanitized = sanitized.replace(pattern, replacement)
  }

  if (sanitized.length > MAX_CONTENT_LENGTH) {
    sanitized = sanitized.slice(0, MAX_CONTENT_LENGTH) + '\n... [truncated]'
  }

  return sanitized
}
