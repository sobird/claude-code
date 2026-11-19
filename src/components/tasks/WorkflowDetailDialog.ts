// Auto-generated stub — replace with real implementation

import type { CommandResultDisplay } from '../../commands.js'

export type WorkflowDetailDialogProps = {
  workflow: unknown
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void
  onKill?: () => void
  onSkipAgent?: (agentId: string) => void
  onRetryAgent?: (agentId: string) => void
  onBack: () => void
}

export const WorkflowDetailDialog: (props: WorkflowDetailDialogProps) => null = () => null
