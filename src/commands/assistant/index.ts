import type { Command } from '../../commands.js'

/**
 * `/assistant` — report the installed assistant daemon, or walk the user
 * through installing one. Registration is already gated on `feature('KAIROS')`
 * by `commands.ts`; `claude assistant` (the subcommand) shares the same wizard
 * via `dialogLaunchers.tsx`.
 */
const assistant = {
  type: 'local-jsx',
  name: 'assistant',
  description: 'Install and connect to the assistant daemon',
  load: () => import('./assistant.js'),
} satisfies Command

export default assistant
