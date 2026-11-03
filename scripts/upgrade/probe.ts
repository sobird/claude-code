import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

import WebSocket, { type RawData } from 'ws'

import type { ProbeScenario, ProbeTrace } from './types'

type RemoteObject = {
  type?: string
  value?: unknown
  unserializableValue?: string
  description?: string
}

type CallFrame = {
  callFrameId: string
  functionName?: string
  location?: { lineNumber?: number; columnNumber?: number }
  returnValue?: RemoteObject
}

type ScriptParsedParams = { scriptId?: string; url?: string }
type PausedParams = { callFrames?: CallFrame[]; hitBreakpoints?: string[] }
type ExecutionContextCreatedParams = { context?: { id?: number; auxData?: { isDefault?: boolean } } }
type ExecutionContextDestroyedParams = { executionContextId?: number }

type CdpMessage = {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { message?: string }
}

type PendingCommand = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

type ScriptWaiter = {
  name: string
  resolve: (url: string | null) => void
  timer: ReturnType<typeof setTimeout>
}

type Send = (method: string, params?: Record<string, unknown>) => Promise<unknown>

const SCRIPT_WAIT_MS = 3000

export function parseInspectorUrl(stderr: string): string | null {
  const match = stderr.match(/ws:\/\/\S+/)
  return match ? match[0] : null
}

function remoteValue(remote: RemoteObject | undefined): unknown {
  if (!remote) return null
  if ('value' in remote) return remote.value
  if (typeof remote.unserializableValue === 'string') return remote.unserializableValue
  return remote.description ?? null
}

function scriptMatches(url: string, name: string): boolean {
  if (url === name) return true
  const urlPath = url.split(/[?#]/)[0]
  return basename(urlPath) === name || basename(urlPath) === basename(name)
}

function rawDataToText(data: RawData): string {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString()
  if (Array.isArray(data)) return Buffer.concat(data).toString()
  return data.toString()
}

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const onError = (error: Error) => {
      socket.off('open', onOpen)
      reject(error)
    }
    const onOpen = () => {
      socket.off('error', onError)
      resolve(socket)
    }
    socket.once('open', onOpen)
    socket.once('error', onError)
  })
}

export async function runProbe(opts: {
  targetPath: string
  scenarioPath: string
  timeoutMs?: number
}): Promise<ProbeTrace> {
  const label = basename(opts.scenarioPath).replace(/\.json$/i, '')
  const trace: ProbeTrace = { label, frames: [], captured: [] }

  let scenario: ProbeScenario
  try {
    scenario = JSON.parse(await readFile(opts.scenarioPath, 'utf8')) as ProbeScenario
  } catch {
    return trace
  }

  const timeoutMs = opts.timeoutMs ?? 15000
  const scriptUrls = new Set<string>()
  const scriptWaiters = new Set<ScriptWaiter>()
  const pending = new Map<number, PendingCommand>()
  const breakpointLabels = new Map<string, string>()

  let child: ChildProcess | undefined
  let socket: WebSocket | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let settled = false
  let nextId = 0
  let pauseQueue: Promise<void> = Promise.resolve()
  let defaultContextId: number | undefined
  let sawEntryPause = false
  let signalBreakpointsReady!: () => void
  const breakpointsReady = new Promise<void>((resolve) => {
    signalBreakpointsReady = resolve
  })

  const send: Send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (!socket) {
        reject(new Error('probe socket is not connected'))
        return
      }
      const id = ++nextId
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })

  function finish(): void {
    if (settled) return
    settled = true
    signalBreakpointsReady()
    if (timer) clearTimeout(timer)
    for (const waiter of scriptWaiters) {
      clearTimeout(waiter.timer)
      waiter.resolve(null)
    }
    scriptWaiters.clear()
    for (const command of pending.values()) command.reject(new Error('probe finished'))
    pending.clear()
    try {
      socket?.close()
    } catch {
      // ignore socket shutdown errors
    }
    try {
      child?.kill('SIGKILL')
    } catch {
      // the child may already be gone
    }
    resolveDone()
  }

  let resolveDone!: () => void
  const done = new Promise<ProbeTrace>((resolve) => {
    resolveDone = () => resolve(trace)
  })

  timer = setTimeout(finish, timeoutMs)

  try {
    child = spawn('node', ['--inspect-brk=0', opts.targetPath, ...(scenario.args ?? [])], {
      env: { ...process.env, ...scenario.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch {
    finish()
    return done
  }

  child.once('error', finish)
  child.once('exit', finish)
  child.stdin?.on('error', () => {
    // the target may close stdin before we finish writing
  })
  if (typeof scenario.stdin === 'string') child.stdin?.end(scenario.stdin)
  else child.stdin?.end()

  const inspectorUrl = await new Promise<string>((resolveUrl) => {
    let resolved = false
    const settle = (url: string) => {
      if (resolved) return
      resolved = true
      resolveUrl(url)
    }
    let stderr = ''
    child?.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
      const url = parseInspectorUrl(stderr)
      if (url) settle(url)
    })
    child?.once('error', () => settle(''))
    child?.once('exit', () => settle(''))
  })

  if (!inspectorUrl || settled) {
    finish()
    return done
  }

  try {
    socket = await openSocket(inspectorUrl)
  } catch {
    finish()
    return done
  }

  function scriptUrlFor(name: string): string | null {
    for (const url of scriptUrls) {
      if (scriptMatches(url, name)) return url
    }
    return null
  }

  function waitForScript(name: string): Promise<string | null> {
    const existing = scriptUrlFor(name)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve) => {
      const waiter: ScriptWaiter = {
        name,
        resolve,
        timer: setTimeout(() => {
          scriptWaiters.delete(waiter)
          resolve(null)
        }, SCRIPT_WAIT_MS),
      }
      scriptWaiters.add(waiter)
    })
  }

  async function evaluate(callFrameId: string, expression: string): Promise<unknown> {
    try {
      const result = (await send('Debugger.evaluateOnCallFrame', {
        callFrameId,
        expression,
        returnByValue: true,
        silent: true,
      })) as { result?: RemoteObject; exceptionDetails?: unknown } | undefined
      if (!result || result.exceptionDetails) return null
      return remoteValue(result.result)
    } catch {
      return null
    }
  }

  async function capture(entry: string, callFrames: CallFrame[]): Promise<unknown> {
    const frame = callFrames[0]
    if (!frame) return null
    if (entry === 'return') return remoteValue(frame.returnValue)
    if (entry === 'args') return evaluate(frame.callFrameId, 'Array.from(arguments)')
    if (entry === 'fn.toString') return evaluate(frame.callFrameId, 'arguments.callee.toString()')
    return evaluate(frame.callFrameId, entry)
  }

  async function handlePaused(params: PausedParams): Promise<void> {
    if (settled) return
    const callFrames = params.callFrames ?? []
    const hitBreakpoints = params.hitBreakpoints ?? []

    // The `--inspect-brk` entry pause holds the target until we have placed
    // every breakpoint; otherwise user code could run past them.
    if (!sawEntryPause) {
      sawEntryPause = true
      if (hitBreakpoints.length === 0) {
        await breakpointsReady
        if (settled) return
      }
    }

    // Any pause we did not request (entry pause, `debugger` statement) simply
    // continues.
    if (hitBreakpoints.length > 0) {
      trace.frames = callFrames.map((frame) => ({
        fn: frame.functionName ?? '',
        line: (frame.location?.lineNumber ?? 0) + 1,
        column: frame.location?.columnNumber ?? 0,
      }))
      for (const breakpointId of hitBreakpoints) {
        const breakpointLabel = breakpointLabels.get(breakpointId)
        if (breakpointLabel === undefined) continue
        const record: Record<string, unknown> = { label: breakpointLabel }
        for (const entry of scenario.capture ?? []) {
          record[entry] = await capture(entry, callFrames)
        }
        trace.captured.push(record)
      }
    }

    try {
      await send('Debugger.resume')
    } catch {
      // the target may have exited while we were evaluating
    }
  }

  socket.on('message', (data: RawData) => {
    let message: CdpMessage
    try {
      message = JSON.parse(rawDataToText(data)) as CdpMessage
    } catch {
      return
    }

    if (typeof message.id === 'number') {
      const command = pending.get(message.id)
      if (!command) return
      pending.delete(message.id)
      if (message.error) command.reject(new Error(message.error.message ?? 'CDP command failed'))
      else command.resolve(message.result)
      return
    }

    if (message.method === 'Debugger.scriptParsed') {
      const params = message.params as ScriptParsedParams
      if (typeof params?.url !== 'string' || params.url === '') return
      scriptUrls.add(params.url)
      for (const waiter of scriptWaiters) {
        if (scriptMatches(params.url, waiter.name)) {
          clearTimeout(waiter.timer)
          scriptWaiters.delete(waiter)
          waiter.resolve(params.url)
        }
      }
      return
    }

    if (message.method === 'Debugger.paused') {
      pauseQueue = pauseQueue.then(() => handlePaused(message.params as PausedParams)).catch(() => {})
      return
    }

    if (message.method === 'Runtime.executionContextCreated') {
      const params = message.params as ExecutionContextCreatedParams
      if (params?.context?.auxData?.isDefault) defaultContextId = params.context.id
      return
    }

    if (message.method === 'Runtime.executionContextDestroyed') {
      const params = message.params as ExecutionContextDestroyedParams
      // The inspector session keeps the process alive after the main script
      // finishes, so treat the default context teardown as target completion.
      if (defaultContextId === undefined || params?.executionContextId === defaultContextId) finish()
    }
  })

  socket.on('close', finish)
  socket.on('error', finish)

  try {
    await send('Runtime.enable')
    await send('Debugger.enable')
    await send('Runtime.runIfWaitingForDebugger')

    // Scripts are only reported once the waiting target is released, so place
    // breakpoints while the entry pause is still holding execution.
    for (const breakpoint of scenario.breakpoints ?? []) {
      const targetUrl = await waitForScript(breakpoint.script)
      if (!targetUrl) continue
      try {
        const result = (await send('Debugger.setBreakpointByUrl', {
          url: targetUrl,
          lineNumber: Math.max(0, breakpoint.line - 1),
          columnNumber: breakpoint.column ?? 0,
        })) as { breakpointId?: string } | undefined
        if (result?.breakpointId) breakpointLabels.set(result.breakpointId, breakpoint.label)
      } catch {
        // ignore breakpoints that cannot be set in this target
      }
    }
    signalBreakpointsReady()
  } catch {
    finish()
  }

  return done
}
