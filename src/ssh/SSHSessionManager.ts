import { randomUUID } from 'node:crypto'

import type {
  SDKControlPermissionRequest,
  SDKControlRequest,
  SDKControlResponse,
} from '../entrypoints/sdk/controlTypes.js'
import type { SDKMessage } from '../entrypoints/sdk/coreTypes.js'
import { logForDebugging } from '../utils/debug.js'
import { logError } from '../utils/log.js'
import type { RemoteMessageContent } from '../utils/teleport/api.js'
import { encodeInterrupt, encodePermissionResponse, encodeUserMessage, parseStdoutLine } from './protocol.js'

/**
 * The stdio transport owned by an SSH session: a bidirectional pipe to the
 * remote CLI (or, in `--local` mode, the child CLI). Kept behind an interface
 * so the manager can be tested without spawning a process.
 */
export interface ManagerTransport {
  write(chunk: string): void
  onLine(cb: (line: string) => void): void
  onExit(cb: (info: { code: number | null; signal: string | null }) => void): void
  kill(): void
}

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

export interface SSHSessionManagerLifecycle {
  /** Rebuild the transport after an unexpected exit; omit to disable reconnect. */
  respawn?: () => ManagerTransport
  maxReconnect?: number
}

const DEFAULT_MAX_RECONNECT = 3

/**
 * Drives a remote `claude --print --input-format stream-json` process.
 *
 * Mirrors `RemoteSessionManager` (src/remote/RemoteSessionManager.ts) but over
 * the ssh child's stdio instead of a WebSocket: stdin carries user messages,
 * interrupts and permission responses; stdout carries SDK messages and
 * `can_use_tool` control requests.
 */
export function createSSHSessionManager(
  transport: ManagerTransport,
  options: SSHSessionManagerOptions,
  lifecycle: SSHSessionManagerLifecycle = {},
): SSHSessionManager {
  const maxReconnect = lifecycle.maxReconnect ?? DEFAULT_MAX_RECONNECT
  const pendingPermissionRequests = new Map<string, SSHPermissionRequest>()

  let current = transport
  let active = true
  let bound = false
  let connected = false
  let reconnectAttempts = 0

  const write = (frame: string): boolean => {
    try {
      current.write(frame)
      return true
    } catch (error) {
      logError(error)
      return false
    }
  }

  const bind = (next: ManagerTransport): void => {
    current = next
    next.onLine(handleLine)
    next.onExit(handleExit)
  }

  const handleControlRequest = (request: SDKControlRequest): void => {
    const { request_id, request: inner } = request
    if (inner.subtype === 'can_use_tool') {
      logForDebugging(`[SSHSessionManager] Permission request for tool: ${inner.tool_name}`)
      pendingPermissionRequests.set(request_id, inner)
      options.onPermissionRequest(inner, request_id)
      return
    }
    // Unrecognized subtypes would otherwise leave the remote waiting forever.
    const response: SDKControlResponse = {
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id,
        error: `Unsupported control request subtype: ${inner.subtype}`,
      },
    }
    write(`${JSON.stringify(response)}\n`)
  }

  const handleLine = (line: string): void => {
    const message = parseStdoutLine(line)
    if (!message) return

    if (!connected) {
      connected = true
      options.onConnected()
    }

    if (message.type === 'control_request') {
      handleControlRequest(message)
      return
    }
    if (message.type === 'control_cancel_request') {
      pendingPermissionRequests.delete(message.request_id)
      return
    }
    if (message.type === 'control_response' || message.type === 'keep_alive') {
      return
    }
    // Streamlined/post-turn frames are SDK message extensions; the REPL's
    // adapter tolerates them, so forward everything that is not control traffic.
    options.onMessage(message as SDKMessage)
  }

  const handleExit = (info: { code: number | null; signal: string | null }): void => {
    if (!active) return
    logForDebugging(
      `[SSHSessionManager] Transport exited (code=${info.code ?? 'null'}, signal=${info.signal ?? 'null'})`,
    )

    if (lifecycle.respawn && reconnectAttempts < maxReconnect) {
      reconnectAttempts += 1
      connected = false
      options.onReconnecting(reconnectAttempts, maxReconnect)
      try {
        bind(lifecycle.respawn())
        return
      } catch (error) {
        active = false
        options.onError(error instanceof Error ? error : new Error(String(error)))
        options.onDisconnected()
        return
      }
    }

    active = false
    options.onDisconnected()
  }

  return {
    connect(): void {
      if (bound) return
      bound = true
      bind(transport)
    },

    disconnect(): void {
      if (!active) return
      active = false
      pendingPermissionRequests.clear()
      current.kill()
    },

    async sendMessage(content: RemoteMessageContent): Promise<boolean> {
      if (!active) return false
      return write(encodeUserMessage(content))
    },

    sendInterrupt(): void {
      if (!active) return
      logForDebugging('[SSHSessionManager] Sending interrupt')
      write(encodeInterrupt(randomUUID()))
    },

    respondToPermissionRequest(requestId, response): void {
      if (!pendingPermissionRequests.has(requestId)) {
        logError(new Error(`[SSHSessionManager] No pending permission request with ID: ${requestId}`))
        return
      }
      pendingPermissionRequests.delete(requestId)
      write(encodePermissionResponse(requestId, response))
    },
  }
}
