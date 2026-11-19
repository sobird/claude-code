import { isBridgeEnabled } from '../../bridge/bridgeEnabled.js'
import type { Command } from '../../types/command.js'

function isEnabled(): boolean {
  // commands.ts only requires this module when DAEMON && BRIDGE_MODE are on,
  // and isBridgeEnabled() carries the inline feature('BRIDGE_MODE') literal
  // itself — no extra build-time guard is needed here.
  return isBridgeEnabled()
}

const remoteControlServer = {
  type: 'local-jsx',
  name: 'remote-control-server',
  aliases: ['rcs'],
  description: 'Start a persistent Remote Control server (daemon) that accepts multiple sessions',
  isEnabled,
  get isHidden() {
    return !isBridgeEnabled()
  },
  immediate: true,
  load: () => import('./remoteControlServer.js'),
} satisfies Command

export default remoteControlServer
