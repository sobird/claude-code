import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import * as React from 'react'

import { INJECTED_ARROW } from '../../constants/figures.js'
import { CROSS_SESSION_MESSAGE_TAG } from '../../constants/xml.js'
import { Box, Text } from '../../ink.js'
import { truncateToWidth } from '../../utils/format.js'

type Props = {
  addMargin: boolean
  param: TextBlockParam
}

// <cross-session-message from="...">
// body
// </cross-session-message>
// udsMessaging wraps inbound UDS frames in exactly this shape.
const CROSS_SESSION_RE = new RegExp(
  `<${CROSS_SESSION_MESSAGE_TAG}\\s+from="([^"]+)">\\n?([\\s\\S]*?)\\n?</${CROSS_SESSION_MESSAGE_TAG}>`,
)
const TRUNCATE_AT = 60

function displaySender(from: string): string {
  // Peers are addressed as `uds:<path>` or `bridge:<session>`; show the leaf.
  const i = from.lastIndexOf(':')
  return i === -1 ? from : from.slice(i + 1)
}

export function UserCrossSessionMessage({ addMargin, param: { text } }: Props): React.ReactNode {
  const m = CROSS_SESSION_RE.exec(text)
  if (!m) return null
  const [, from, content] = m
  const body = (content ?? '').trim().replace(/\s+/g, ' ')
  const truncated = truncateToWidth(body, TRUNCATE_AT)
  return (
    <Box marginTop={addMargin ? 1 : 0}>
      <Text>
        <Text color="suggestion">{INJECTED_ARROW}</Text> <Text dimColor>{displaySender(from ?? 'unknown')}:</Text>{' '}
        {truncated}
      </Text>
    </Box>
  )
}
