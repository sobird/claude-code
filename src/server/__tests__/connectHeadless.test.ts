import { describe, expect, test } from 'bun:test'

import type { SDKMessage, SDKResultMessage } from '../../entrypoints/agentSdkTypes.js'
import type { RemotePermissionResponse } from '../../remote/RemoteSessionManager.js'
import type { ConnectHeadlessOverrides, HeadlessManager } from '../connectHeadless.js'
import { formatResultOutput, parseOutputFormat, runConnectHeadless } from '../connectHeadless.js'
import type { DirectConnectCallbacks, DirectConnectConfig } from '../directConnectManager.js'

const CONFIG: DirectConnectConfig = {
  serverUrl: 'http://127.0.0.1:9999',
  sessionId: 'sess-1',
  wsUrl: 'ws://127.0.0.1:9999/ws',
}

function successResult(result: string): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    result,
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: false,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0,
    usage: {} as never,
    modelUsage: {},
    permission_denials: [],
    uuid: 'u-1' as never,
    session_id: 'sess-1',
  } as SDKResultMessage
}

function errorResult(subtype: 'error_during_execution' | 'error_max_turns'): SDKResultMessage {
  return {
    type: 'result',
    subtype,
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: true,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0,
    usage: {} as never,
    modelUsage: {},
    permission_denials: [],
    errors: ['boom'],
    uuid: 'u-2' as never,
    session_id: 'sess-1',
  } as SDKResultMessage
}

describe('parseOutputFormat', () => {
  test('accepts the three supported formats', () => {
    expect(parseOutputFormat('text')).toBe('text')
    expect(parseOutputFormat('json')).toBe('json')
    expect(parseOutputFormat('stream-json')).toBe('stream-json')
  })

  test('returns null for an unsupported format', () => {
    expect(parseOutputFormat('yaml')).toBeNull()
  })
})

describe('formatResultOutput', () => {
  test('success + text emits the result and exit code 0', () => {
    expect(formatResultOutput(successResult('hello'), 'text')).toEqual({ text: 'hello\n', exitCode: 0 })
  })

  test('success + text does not double a trailing newline', () => {
    expect(formatResultOutput(successResult('hello\n'), 'text')).toEqual({ text: 'hello\n', exitCode: 0 })
  })

  test('success + json emits a single JSON line and exit code 0', () => {
    const result = successResult('hello')
    const out = formatResultOutput(result, 'json')
    expect(out.exitCode).toBe(0)
    expect(out.text.endsWith('\n')).toBe(true)
    expect(JSON.parse(out.text)).toMatchObject({ type: 'result', subtype: 'success', result: 'hello' })
  })

  test('error_during_execution + text emits an error and exit code 1', () => {
    expect(formatResultOutput(errorResult('error_during_execution'), 'text')).toEqual({
      text: 'Execution error\n',
      exitCode: 1,
    })
  })

  test('error_max_turns + text emits an error and exit code 1', () => {
    expect(formatResultOutput(errorResult('error_max_turns'), 'text')).toEqual({
      text: 'Error: Reached max turns\n',
      exitCode: 1,
    })
  })

  test('stream-json emits nothing extra (messages already streamed)', () => {
    expect(formatResultOutput(successResult('hi'), 'stream-json')).toEqual({ text: '', exitCode: 0 })
    expect(formatResultOutput(errorResult('error_during_execution'), 'stream-json')).toEqual({
      text: '',
      exitCode: 1,
    })
  })
})

interface Harness {
  overrides: ConnectHeadlessOverrides
  manager: HeadlessManager
  sent: string[]
  permissionResponses: Array<{ requestId: string; response: RemotePermissionResponse }>
  stdout: string[]
  stderr: string[]
  exitCodes: number[]
  /** Codes passed to the injected process-termination callback. */
  processExits: number[]
  callbacks: () => DirectConnectCallbacks
  disconnectCalls: () => number
}

function makeHarness(sendResult = true): Harness {
  let callbacks: DirectConnectCallbacks | undefined
  let disconnectCount = 0
  const sent: string[] = []
  const permissionResponses: Array<{ requestId: string; response: RemotePermissionResponse }> = []
  const stdout: string[] = []
  const stderr: string[] = []
  const exitCodes: number[] = []
  const processExits: number[] = []

  const manager: HeadlessManager = {
    connect() {
      callbacks?.onConnected?.()
    },
    sendMessage(content) {
      sent.push(content)
      return sendResult
    },
    respondToPermissionRequest(requestId, response) {
      permissionResponses.push({ requestId, response })
    },
    sendInterrupt() {},
    disconnect() {
      disconnectCount++
    },
    isConnected() {
      return true
    },
  }

  const overrides: ConnectHeadlessOverrides = {
    createManager: (_config, cb) => {
      callbacks = cb
      return manager
    },
    readStdin: async () => '',
    writeStdout: (data) => stdout.push(data),
    writeStderr: (data) => stderr.push(data),
    setExitCode: (code) => exitCodes.push(code),
    // A real run calls process.exit; tests capture the code instead.
    exit: (code) => processExits.push(code),
  }

  return {
    overrides,
    manager,
    sent,
    permissionResponses,
    stdout,
    stderr,
    exitCodes,
    processExits,
    callbacks: () => {
      if (!callbacks) throw new Error('callbacks not captured yet')
      return callbacks
    },
    disconnectCalls: () => disconnectCount,
  }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('runConnectHeadless', () => {
  test('rejects an empty prompt without connecting', async () => {
    const h = makeHarness()
    let connected = false
    h.overrides.createManager = () => {
      connected = true
      throw new Error('should not be called')
    }
    await runConnectHeadless(CONFIG, '', 'text', false, h.overrides)
    expect(connected).toBe(false)
    expect(h.exitCodes).toEqual([1])
    expect(h.stderr.join('')).toMatch(/Input must be provided/i)
  })

  test('rejects an unsupported output format without connecting', async () => {
    const h = makeHarness()
    let connected = false
    h.overrides.createManager = () => {
      connected = true
      throw new Error('should not be called')
    }
    await runConnectHeadless(CONFIG, 'hi', 'yaml', false, h.overrides)
    expect(connected).toBe(false)
    expect(h.exitCodes).toEqual([1])
    expect(h.stderr.join('')).toMatch(/output-format/i)
  })

  test('reads the prompt from stdin when interactive', async () => {
    const h = makeHarness()
    h.overrides.readStdin = async () => 'piped prompt'
    const p = runConnectHeadless(CONFIG, '', 'text', true, h.overrides)
    await flush()
    expect(h.sent).toEqual(['piped prompt'])
    h.callbacks().onMessage(successResult('ok'))
    await p
    expect(h.exitCodes).toEqual([0])
  })

  test('sends the prompt on connect and streams messages in stream-json', async () => {
    const h = makeHarness()
    const p = runConnectHeadless(CONFIG, 'hi', 'stream-json', false, h.overrides)
    expect(h.sent).toEqual(['hi'])
    const assistant: SDKMessage = { type: 'assistant', message: { content: [] } } as unknown as SDKMessage
    h.callbacks().onMessage(assistant)
    h.callbacks().onMessage(successResult('done'))
    await p
    expect(h.exitCodes).toEqual([0])
    const lines = h.stdout.join('').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0])).toMatchObject({ type: 'assistant' })
    expect(JSON.parse(lines[1])).toMatchObject({ type: 'result', subtype: 'success' })
  })

  test('emits only the final result in json format', async () => {
    const h = makeHarness()
    const p = runConnectHeadless(CONFIG, 'hi', 'json', false, h.overrides)
    h.callbacks().onMessage({ type: 'assistant', message: { content: [] } } as unknown as SDKMessage)
    h.callbacks().onMessage(successResult('done'))
    await p
    expect(h.exitCodes).toEqual([0])
    expect(h.stdout).toHaveLength(1)
    expect(JSON.parse(h.stdout[0])).toMatchObject({ type: 'result', subtype: 'success', result: 'done' })
  })

  test('emits only the final result text in text format', async () => {
    const h = makeHarness()
    const p = runConnectHeadless(CONFIG, 'hi', 'text', false, h.overrides)
    h.callbacks().onMessage({ type: 'assistant', message: { content: [] } } as unknown as SDKMessage)
    h.callbacks().onMessage(successResult('done'))
    await p
    expect(h.exitCodes).toEqual([0])
    expect(h.stdout).toEqual(['done\n'])
  })

  test('denies permission requests and reports them on stderr', async () => {
    const h = makeHarness()
    const p = runConnectHeadless(CONFIG, 'hi', 'text', false, h.overrides)
    h.callbacks().onPermissionRequest(
      { tool_name: 'Bash', input: { command: 'rm -rf /' }, tool_use_id: 't-1' } as never,
      'req-1',
    )
    expect(h.permissionResponses).toHaveLength(1)
    expect(h.permissionResponses[0].requestId).toBe('req-1')
    expect(h.permissionResponses[0].response.behavior).toBe('deny')
    expect(h.stderr.join('')).toMatch(/Bash/)
    h.callbacks().onMessage(successResult('ok'))
    await p
  })

  test('returns exit code 1 on an error result', async () => {
    const h = makeHarness()
    const p = runConnectHeadless(CONFIG, 'hi', 'text', false, h.overrides)
    h.callbacks().onMessage(errorResult('error_during_execution'))
    await p
    expect(h.exitCodes).toEqual([1])
    expect(h.stdout.join('')).toContain('Execution error')
  })

  test('returns exit code 1 when the server disconnects before a result', async () => {
    const h = makeHarness()
    const p = runConnectHeadless(CONFIG, 'hi', 'text', false, h.overrides)
    h.callbacks().onDisconnected?.()
    await p
    expect(h.exitCodes).toEqual([1])
    expect(h.stderr.join('')).toMatch(/disconnected/i)
  })

  test('returns exit code 1 when the prompt cannot be sent', async () => {
    const h = makeHarness(false)
    await runConnectHeadless(CONFIG, 'hi', 'text', false, h.overrides)
    expect(h.exitCodes).toEqual([1])
    expect(h.stderr.join('')).toMatch(/send/i)
  })

  test('disconnects when the session finishes', async () => {
    const h = makeHarness()
    const p = runConnectHeadless(CONFIG, 'hi', 'text', false, h.overrides)
    h.callbacks().onMessage(successResult('ok'))
    await p
    expect(h.disconnectCalls()).toBe(1)
  })

  test('terminates the process with code 0 after a successful result', async () => {
    const h = makeHarness()
    const p = runConnectHeadless(CONFIG, 'hi', 'text', false, h.overrides)
    h.callbacks().onMessage(successResult('ok'))
    await p
    expect(h.processExits).toEqual([0])
  })

  test('terminates the process with code 1 after an error result', async () => {
    const h = makeHarness()
    const p = runConnectHeadless(CONFIG, 'hi', 'text', false, h.overrides)
    h.callbacks().onMessage(errorResult('error_during_execution'))
    await p
    expect(h.processExits).toEqual([1])
  })

  test('terminates the process with code 1 when the prompt cannot be sent', async () => {
    const h = makeHarness(false)
    await runConnectHeadless(CONFIG, 'hi', 'text', false, h.overrides)
    expect(h.processExits).toEqual([1])
  })
})
