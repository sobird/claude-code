import type { Command } from '../../commands.js'

const stopHook = {
  type: 'local-jsx',
  name: 'stop-hook',
  description: 'Set a session-only Stop hook with a quick prompt',
  immediate: true,
  // Upstream ships this hidden in 2.1.92 (isEnabled false); kept identical so
  // the surface stays dormant until it's enabled upstream.
  isEnabled: () => false,
  load: () => import('./stop-hook.js'),
} satisfies Command

export default stopHook
