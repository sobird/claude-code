// Auto-generated stub — replace with real implementation
import React from 'react'

import { Box, Text } from '../../ink.js'
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js'

type Props = {
  onOwnsEscChange?: (inOwnsEscChange: boolean) => void
  contentHeight?: number
}

export function Gates({ onOwnsEscChange, contentHeight }: Props): React.ReactNode {
  return (
    <Box flexDirection="column" gap={1} width="100%">
      <Text dimColor>/gates is only available for anthropic staff.</Text>

      <Text dimColor>
        <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="cancel" />
      </Text>
    </Box>
  )
}
