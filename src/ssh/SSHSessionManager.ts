// Auto-generated stub — replace with real implementation
import type { SDKControlPermissionRequest } from '../entrypoints/sdk/controlTypes.js'
import type { SDKMessage } from '../entrypoints/sdk/coreTypes.js'
import type { RemoteMessageContent } from '../utils/teleport/api.js'

export interface SSHSessionManagerOptions {
  onMessage: (sdkMessage: SDKMessage) => void
  onPermissionRequest: (request: SSHPermissionRequest, requestId: string) => void
  onConnected: () => void
  onReconnecting: (attempt: number, max: number) => void
  onDisconnected: () => void
  onError: (error: Error) => void
}

/** Mirrors the SDK `can_use_tool` control request the manager forwards. */
export type SSHPermissionRequest = SDKControlPermissionRequest

export interface SSHSessionManager {
  connect(): void
  disconnect(): void
  sendMessage(content: RemoteMessageContent): Promise<boolean>
  sendInterrupt(): void
  respondToPermissionRequest(
    requestId: string,
    response: { behavior: string; message?: string; updatedInput?: unknown },
  ): void
}
