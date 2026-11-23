import { loadConfig } from './config'
import { startBridge } from './session'
import { errorMessage } from './util'

async function main(): Promise<void> {
  const config = loadConfig()
  const bridge = await startBridge(config)
  process.stdout.write(`dsh-bridge attached to ${config.rcsBaseUrl} session ${bridge.sessionId}\n`)

  let stopping = false
  const shutdown = async (): Promise<void> => {
    if (stopping) return
    stopping = true
    await bridge.stop()
    process.exit(0)
  }

  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
  await bridge.done
}

void main().catch((error: unknown) => {
  process.stderr.write(`dsh-bridge failed: ${errorMessage(error)}\n`)
  process.exit(1)
})
