import { type ReactNode, useState } from 'react'

import { VertexSetupWizard } from '../../components/VertexSetupWizard.js'
import { Box, Text, useApp } from '../../ink.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import { logEvent } from '../../services/analytics/index.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { execRelaunch } from '../../utils/cliLaunch.js'

export async function call(onDone: LocalJSXCommandOnDone): Promise<ReactNode> {
  logEvent('tengu_vertex_setup_started', {})
  return <VertexSetupRunner onDone={onDone} />
}

function VertexSetupRunner({ onDone }: { onDone: LocalJSXCommandOnDone }): ReactNode {
  const app = useApp()
  const [message, setMessage] = useState<string | null>(null)
  // Vertex config only takes effect on the next start, so once the wizard saves
  // it we offer a restart instead of returning to the REPL.
  useKeybinding(
    'confirm:yes',
    () => {
      app.exit()
      void execRelaunch()
    },
    { context: 'Confirmation', isActive: message !== null },
  )

  if (message !== null) {
    return (
      <Box flexDirection="column" gap={1} marginTop={1}>
        <Text color="success">{message}</Text>
        <Text dimColor>
          Press <Text bold>Enter</Text> to restart Claude Code.
        </Text>
      </Box>
    )
  }

  return (
    <VertexSetupWizard
      onComplete={(result) => setMessage(result)}
      onCancel={() => {
        logEvent('tengu_vertex_setup_cancelled', {})
        onDone()
      }}
    />
  )
}
