import * as React from 'react'

import { Box, Text } from '../../ink.js'
import type { Message } from '../../types/message.js'

type Props = {
  message: Message
}

type SnipMetadata = {
  removedUuids?: unknown[]
  tokensFreed?: number
}

function getSnipMetadata(message: Message): SnipMetadata | undefined {
  if (message.type !== 'system') return undefined
  const metadata = (message as { snipMetadata?: unknown }).snipMetadata
  return typeof metadata === 'object' && metadata !== null ? (metadata as SnipMetadata) : undefined
}

/**
 * Boundary left behind by the HISTORY_SNIP pass. The removed messages are
 * projected away everywhere else, so this row is the only trace that a snip
 * happened — mirror CompactBoundaryMessage's dim one-liner.
 */
export function SnipBoundaryMessage({ message }: Props): React.ReactNode {
  const metadata = getSnipMetadata(message)
  const removed = metadata?.removedUuids?.length ?? 0
  const tokensFreed = metadata?.tokensFreed ?? 0
  const detail = [
    removed > 0 ? `${removed} message${removed === 1 ? '' : 's'}` : null,
    tokensFreed > 0 ? `~${tokensFreed} tokens` : null,
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <Box marginY={1}>
      <Text dimColor>✂ Context snipped{detail ? ` (${detail} freed)` : ''}</Text>
    </Box>
  )
}
