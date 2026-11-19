import { feature } from 'bun:bundle'

import { isBridgeEnabled } from '../../bridge/bridgeEnabled.js'
import type { Command } from '../../types/command.js'

function isEnabled(): boolean {
  // commands.ts only loads this module when DAEMON && BRIDGE_MODE are on, but
  // keep the literal guard so the flag string is inlined for tree-shaking.
  return feature('BRIDGE_MODE') ? isBridgeEnabled() : false
}

const remoteControlServer = {
  type: 'local-jsx',
  name: 'remote-control-server',
  aliases: ['rcs'],
  description: 'Start a persistent Remote Control server (daemon) that accepts multiple sessions',
  isEnabled,
  get isHidden() {
    return !isEnabled()
  },
  immediate: true,
  load: () => import('./remoteControlServer.js'),
} satisfies Command

export default remoteControlServer
