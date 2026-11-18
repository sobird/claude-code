import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'

/**
 * The surface `remoteIO` drives on the transport returned by the bridge
 * factory. Implemented by both `SSETransport` and `WebSocketTransport`; their
 * state-specific extras (`setOnEvent`, `getStateLabel`, sequence tracking) stay
 * on the concrete classes. `ReplBridgeTransport` in
 * `src/bridge/replBridgeTransport.ts` is a different, higher-level interface.
 */
export interface Transport {
  connect(): Promise<void>
  write(message: StdoutMessage): Promise<void>
  close(): void
  isConnectedStatus(): boolean
  isClosedStatus(): boolean
  setOnData(callback: (data: string) => void): void
  setOnClose(callback: (closeCode?: number) => void): void
}
