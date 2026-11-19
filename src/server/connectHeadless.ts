/**
 * `claude open <cc://…> -p` — headless client for a Claude Code direct-connect
 * server.
 *
 * The server owns the session and runs the actual agent. This module drives the
 * WebSocket client (`DirectConnectSessionManager`) the same way the REPL does,
 * but with no UI:
 *
 *   1. Send the prompt as a single user turn once the socket opens.
 *   2. Stream SDK messages back in `--output-format` (`text` / `json` /
 *      `stream-json`).
 *   3. Answer permission requests by denying them — headless mode has no one to
 *      ask (use `--dangerously-skip-permissions` on the server to allow tools
 *      up front).
 *   4. Resolve when the terminal `result` message arrives, mapping its subtype
 *      to a process exit code.
 */

import type { SDKMessage, SDKResultMessage } from '../entrypoints/agentSdkTypes.js'
import type { RemotePermissionResponse } from '../remote/RemoteSessionManager.js'
import { peekForStdinData, writeToStderr, writeToStdout } from '../utils/process.js'
import { jsonStringify } from '../utils/slowOperations.js'
import type { DirectConnectCallbacks, DirectConnectConfig } from './directConnectManager.js'
import { DirectConnectSessionManager } from './directConnectManager.js'

export type ConnectOutputFormat = 'text' | 'json' | 'stream-json'

/**
 * Structural subset of `DirectConnectSessionManager` used by the runner. Lets
 * tests supply an in-memory fake without a real WebSocket.
 */
export interface HeadlessManager {
  connect(): void
  sendMessage(content: string): boolean
  respondToPermissionRequest(requestId: string, response: RemotePermissionResponse): void
  sendInterrupt(): void
  disconnect(): void
  isConnected(): boolean
}

export interface ConnectHeadlessOverrides {
  createManager?: (config: DirectConnectConfig, callbacks: DirectConnectCallbacks) => HeadlessManager
  readStdin?: () => Promise<string>
  writeStdout?: (data: string) => void
  writeStderr?: (data: string) => void
  setExitCode?: (code: number) => void
  /**
   * Terminate the process once the run ends. Defaults to `process.exit` — a
   * one-shot command can't rely on the event loop draining, because inherited
   * handles (stdin socket, telemetry flush) keep it alive after the result is
   * printed. Tests inject a no-op so they can `await` the run without aborting
   * the test process.
   */
  exit?: (code: number) => void
}

/** Map the `--output-format` value to a supported format, or `null`. */
export function parseOutputFormat(value: string): ConnectOutputFormat | null {
  if (value === 'text' || value === 'json' || value === 'stream-json') {
    return value
  }
  return null
}

/**
 * Render a terminal `result` message for the chosen output format and derive
 * the process exit code. Returns empty text for `stream-json`, where every
 * message (including the result) was already streamed as it arrived.
 */
export function formatResultOutput(
  result: SDKResultMessage,
  format: ConnectOutputFormat,
): { text: string; exitCode: number } {
  const exitCode = result.subtype === 'success' ? 0 : 1

  if (format === 'stream-json') {
    return { text: '', exitCode }
  }

  if (format === 'json') {
    return { text: jsonStringify(result) + '\n', exitCode }
  }

  // text
  if (result.subtype === 'success') {
    return { text: result.result.endsWith('\n') ? result.result : result.result + '\n', exitCode: 0 }
  }

  switch (result.subtype) {
    case 'error_max_turns':
      return { text: 'Error: Reached max turns\n', exitCode: 1 }
    case 'error_max_budget_usd':
      return { text: 'Error: Exceeded USD budget\n', exitCode: 1 }
    case 'error_max_structured_output_retries':
      return { text: 'Error: Failed to provide valid structured output after maximum retries\n', exitCode: 1 }
    case 'error_during_execution':
    default:
      return { text: 'Execution error\n', exitCode: 1 }
  }
}

/** Read all of stdin as text, mirroring `-p` prompt reading in `main.tsx`. */
async function readStdinText(): Promise<string> {
  if (process.stdin.isTTY) {
    return ''
  }
  process.stdin.setEncoding('utf8')
  let data = ''
  const onData = (chunk: string) => {
    data += chunk
  }
  process.stdin.on('data', onData)
  const timedOut = await peekForStdinData(process.stdin, 3000)
  process.stdin.off('data', onData)
  if (timedOut) {
    process.stderr.write(
      'Warning: no stdin data received in 3s, proceeding without it. ' +
        'If piping from a slow command, redirect stdin explicitly: < /dev/null to skip, or wait longer.\n',
    )
  }
  return data
}

/**
 * Run a headless turn against a direct-connect server and set the process exit
 * code (0 on a successful result, 1 otherwise). Resolves once the session ends.
 */
export async function runConnectHeadless(
  connectConfig: DirectConnectConfig,
  prompt: string,
  outputFormat: string,
  interactive: boolean,
  overrides: ConnectHeadlessOverrides = {},
): Promise<void> {
  const createManager =
    overrides.createManager ?? ((config, callbacks) => new DirectConnectSessionManager(config, callbacks))
  const readStdin = overrides.readStdin ?? readStdinText
  const writeStdout = overrides.writeStdout ?? writeToStdout
  const writeStderr = overrides.writeStderr ?? writeToStderr
  const setExitCode = overrides.setExitCode ?? ((code: number) => void (process.exitCode = code))
  const exit = overrides.exit ?? ((code: number) => process.exit(code))

  const format = parseOutputFormat(outputFormat)
  if (!format) {
    writeStderr(`Error: unsupported --output-format: ${outputFormat} (expected text, json, or stream-json)\n`)
    setExitCode(1)
    return exit(1)
  }

  // `-p` with no prompt value means "read the prompt from stdin".
  let effectivePrompt = prompt
  if (interactive) {
    const stdin = await readStdin()
    effectivePrompt = [prompt, stdin].filter(Boolean).join('\n')
  }
  if (!effectivePrompt.trim()) {
    writeStderr('Error: Input must be provided either through stdin or as a prompt argument when using --print\n')
    setExitCode(1)
    return exit(1)
  }

  let finalCode = 0
  await new Promise<void>((resolve) => {
    let settled = false
    let connected = false
    let managerRef: HeadlessManager | undefined

    const finish = (code: number): void => {
      if (settled) return
      settled = true
      finalCode = code
      setExitCode(code)
      managerRef?.disconnect()
      resolve()
    }

    const manager = createManager(connectConfig, {
      onConnected: () => {
        connected = true
        if (!managerRef?.sendMessage(effectivePrompt)) {
          writeStderr('Error: failed to send the prompt to the server\n')
          finish(1)
        }
      },
      onMessage: (message: SDKMessage) => {
        if (format === 'stream-json') {
          writeStdout(jsonStringify(message) + '\n')
        }
        if (message.type === 'result') {
          const { text, exitCode } = formatResultOutput(message, format)
          if (text) {
            writeStdout(text)
          }
          finish(exitCode)
        }
      },
      onPermissionRequest: (request, requestId) => {
        // No UI in headless mode: deny and explain how to allow it up front.
        const reason =
          `Permission required for "${request.tool_name}" but headless mode cannot prompt. ` +
          'Start the server session with --dangerously-skip-permissions to allow tools.'
        writeStderr(`Permission denied for "${request.tool_name}"\n`)
        managerRef?.respondToPermissionRequest(requestId, { behavior: 'deny', message: reason })
      },
      onDisconnected: () => {
        if (settled) return
        writeStderr(
          connected
            ? 'Error: server disconnected before the session completed\n'
            : `Error: failed to connect to the server at ${connectConfig.wsUrl}\n`,
        )
        finish(1)
      },
      onError: (error) => {
        writeStderr(`Warning: ${error.message}\n`)
      },
    })

    managerRef = manager
    manager.connect()
  })

  // Disconnect has already run inside `finish`; now terminate the process so a
  // one-shot command returns instead of waiting on lingering runtime handles.
  exit(finalCode)
}
