import type { Command } from '../../commands.js'

const fork = {
  type: 'local-jsx',
  name: 'fork',
  description: 'Fork this conversation into a background worker that runs a directive',
  argumentHint: '<directive>',
  load: () => import('./fork.js'),
} satisfies Command

export default fork
