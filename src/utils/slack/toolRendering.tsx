import * as React from 'react'

import { Ansi, Box } from '../../ink.js'
import { supportsHyperlinks } from '../../ink/supports-hyperlinks.js'
import { createHyperlink } from '../hyperlink.js'
import { jsonStringify } from '../slowOperations.js'

// Slack channel IDs start with C (public), G (private) or D (DM) followed by
// 6+ uppercase alphanumerics. Anything else (e.g. "#general" or a User-typed
// name) is shown as a plain label without a deep link.
const SLACK_CHANNEL_ID = /^[CDG][A-Z0-9]{6,}$/
const SLACK_TOOL_NAMES = new Set(['slack_send_message', 'slack_post_message'])

export function isSlackMCPToolName(name: string): boolean {
  return SLACK_TOOL_NAMES.has(name)
}

function resolveSlackChannel(input: Partial<Record<string, unknown>>): { label: string; url: string | null } | null {
  const raw = input.channel_id ?? input.channel
  if (typeof raw !== 'string' || !raw) return null
  const id = raw.replace(/^#/, '')
  const label = `#${id}`
  const url = SLACK_CHANNEL_ID.test(id) ? `https://slack.com/app_redirect?channel=${id}` : null
  return { label, url }
}

export function getSlackMCPToolOverrides(): {
  userFacingName: () => string
  renderToolUseMessage: (input: Record<string, unknown>, options: { verbose: boolean }) => React.ReactNode
  renderToolUseTag: (input: Partial<Record<string, unknown>>) => React.ReactNode
} {
  return {
    userFacingName() {
      return 'Slacked'
    },
    renderToolUseMessage(input, { verbose }) {
      if (!verbose) return ''
      return Object.entries(input)
        .map(([key, value]) => `${key}: ${jsonStringify(value)}`)
        .join(', ')
    },
    renderToolUseTag(input) {
      const channel = resolveSlackChannel(input)
      if (channel === null) return null
      return (
        <Box flexWrap="nowrap" marginLeft={1}>
          <Ansi>
            {channel.url && supportsHyperlinks() ? createHyperlink(channel.url, channel.label) : channel.label}
          </Ansi>
        </Box>
      )
    },
  }
}
