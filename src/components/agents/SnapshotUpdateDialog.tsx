import { Box, Text } from '../../ink.js'
import { getAgentMemoryDir, getMemoryScopeDisplay, type AgentMemoryScope } from '../../tools/AgentTool/agentMemory.js'
import {
  getSnapshotDirForAgent,
  markSnapshotSynced,
  replaceFromSnapshot,
} from '../../tools/AgentTool/agentMemorySnapshot.js'
import { Select } from '../CustomSelect/index.js'
import { Dialog } from '../design-system/Dialog.js'

type SnapshotChoice = 'merge' | 'keep' | 'replace'

interface Props {
  agentType: string
  scope: AgentMemoryScope
  snapshotTimestamp: string
  onComplete: (choice: SnapshotChoice) => void
  onCancel: () => void
}

/**
 * Prompt shown at startup when a project agent-memory snapshot is newer than
 * what this agent last synced. The user decides whether to merge it into
 * local memory, keep local memory as-is, or replace local memory outright.
 */
export function SnapshotUpdateDialog({
  agentType,
  scope,
  snapshotTimestamp,
  onComplete,
  onCancel,
}: Props): React.ReactNode {
  const handleSelect = (choice: SnapshotChoice): void => {
    if (choice === 'merge') {
      // main.tsx injects the merge prompt; the agent writes the synced marker
      // once the merge is done, so nothing is lost if the merge fails.
      onComplete('merge')
      return
    }
    const action =
      choice === 'replace'
        ? replaceFromSnapshot(agentType, scope, snapshotTimestamp)
        : markSnapshotSynced(agentType, scope, snapshotTimestamp)
    void action.catch(() => {}).finally(() => onComplete(choice))
  }

  return (
    <Dialog
      title="Agent memory snapshot updated"
      subtitle={`A newer memory snapshot for "${agentType}" is available (${snapshotTimestamp}). Local scope: ${getMemoryScopeDisplay(scope)}.`}
      onCancel={onCancel}
      hideInputGuide
    >
      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor>Merge keeps both your local notes and the new shared knowledge.</Text>
      </Box>
      <Select
        options={[
          { value: 'merge', label: 'Merge snapshot into memory (recommended)' },
          { value: 'keep', label: 'Keep my memory (skip this update)' },
          { value: 'replace', label: 'Replace my memory with the snapshot' },
        ]}
        onChange={handleSelect}
      />
    </Dialog>
  )
}

/**
 * Prompt injected into the next turn after the user chooses "merge". Points
 * the agent at both directories, asks for an in-place merge, and tells it how
 * to record the sync so the update isn't offered again.
 */
export function buildMergePrompt(agentType: string, scope: AgentMemoryScope): string {
  const snapshotDir = getSnapshotDirForAgent(agentType)
  const memoryDir = getAgentMemoryDir(agentType, scope)
  return `# Merge updated agent memory snapshot

The shared memory snapshot for agent "${agentType}" changed. Merge it into your persistent memory before continuing.

- Snapshot directory: \`${snapshotDir}\`
- Your memory directory: \`${memoryDir}\`

Steps:
1. Read \`${snapshotDir}/snapshot.json\` to get its \`updatedAt\` value.
2. Read every other file in the snapshot directory.
3. Read your existing memory files.
4. Merge in place: keep local knowledge the snapshot lacks, adopt new or corrected facts from the snapshot, and prefer editing existing topic files over creating near-duplicates. Convert relative dates to absolute dates.
5. When finished, write \`${memoryDir}/.snapshot-synced.json\` with:
   \`{"syncedFrom":"<updatedAt from snapshot.json>"}\`

Then continue with the original task.`
}
