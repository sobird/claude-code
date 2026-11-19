import type { Command } from '../../commands.js'

const workflows = {
  type: 'local',
  name: 'workflows',
  description: 'List workflows defined in .claude/workflows',
  supportsNonInteractive: true,
  load: () => import('./workflows.js'),
} satisfies Command

export default workflows
