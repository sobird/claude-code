import type { Command } from '../../commands.js'

const feedback = {
  aliases: ['bug'],
  type: 'local-jsx',
  name: 'feedback',
  description: `Submit feedback about Claude Code`,
  argumentHint: '[report]',
  // Always visible: when unavailable, /feedback explains why (see
  // getFeedbackUnavailableReason) instead of silently disappearing.
  isEnabled: () => true,
  load: () => import('./feedback.js'),
} satisfies Command

export default feedback
