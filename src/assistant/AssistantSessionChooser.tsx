import { Select } from '../components/CustomSelect/index.js'
import { Dialog } from '../components/design-system/Dialog.js'
import { Box, Text } from '../ink.js'
import type { AssistantSession } from './sessionDiscovery.js'

export type AssistantSessionChooserProps = {
  sessions: AssistantSession[]
  onSelect: (id: string) => void
  onCancel: () => void
}

function describeSession(session: AssistantSession): string {
  const parts: string[] = []
  if (session.status) parts.push(session.status)
  if (session.updatedAt) {
    const parsed = new Date(session.updatedAt)
    if (!Number.isNaN(parsed.getTime())) parts.push(parsed.toLocaleString())
  }
  if (session.directory) parts.push(session.directory)
  return parts.length > 0 ? parts.join(' · ') : session.id.slice(0, 8)
}

/**
 * Picker shown by `claude assistant` when the daemon owns more than one live
 * session. Each row is the session title (or its short id) plus timestamp and
 * workspace so the user can tell them apart.
 */
export function AssistantSessionChooser({
  sessions,
  onSelect,
  onCancel,
}: AssistantSessionChooserProps): React.ReactNode {
  return (
    <Dialog title="Assistant sessions" subtitle="Choose a session to attach to" onCancel={onCancel} hideInputGuide>
      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor>This CLI becomes a viewer — the agent loop runs in the daemon.</Text>
      </Box>
      <Select
        options={sessions.map((session) => ({
          value: session.id,
          label: session.title || session.id.slice(0, 8),
          description: describeSession(session),
        }))}
        onChange={(value: string) => onSelect(value)}
        onCancel={onCancel}
      />
    </Dialog>
  )
}
