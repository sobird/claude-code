import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { BridgeConfig } from '../config'
import { startBridge, type Bridge } from '../session'

const SESSION_ID = 'cse_test'

/** 进程内假 RCS：只实现 bridge 用到的会话/worker/事件/SSE 端点。 */
class FakeRcs {
  readonly events: Record<string, unknown>[] = []
  readonly statuses: { status: string; details: unknown }[] = []
  heartbeats = 0

  private seq = 0
  private readonly controllers = new Set<ReadableStreamDefaultController<Uint8Array>>()
  private pending: Uint8Array[] = []
  private server: ReturnType<typeof Bun.serve> | null = null

  start(): void {
    this.server = Bun.serve({
      port: 0,
      fetch: (request) => this.handle(request),
    })
  }

  get origin(): string {
    if (!this.server) throw new Error('fake RCS not started')
    return this.server.url.origin
  }

  /** 往 worker SSE 推一帧出站事件（相当于 RCS 下发给 bridge）。 */
  push(payload: Record<string, unknown>): void {
    this.seq += 1
    this.sendFrame(this.seq, JSON.stringify(payload))
  }

  /** 以真实网关的信封形状推帧：`{event_id, sequence_num, event_type, payload}`。 */
  pushEnvelope(eventType: string, payload: Record<string, unknown>): void {
    this.seq += 1
    const data = JSON.stringify({
      event_id: `e${this.seq}`,
      sequence_num: this.seq,
      event_type: eventType,
      source: 'client',
      payload,
      created_at: new Date().toISOString(),
    })
    this.sendFrame(this.seq, data)
  }

  private sendFrame(seq: number, data: string): void {
    const bytes = new TextEncoder().encode(`id: ${seq}\nevent: client_event\ndata: ${data}\n\n`)
    if (this.controllers.size === 0) {
      this.pending.push(bytes)
      return
    }
    for (const controller of this.controllers) {
      try {
        controller.enqueue(bytes)
      } catch {
        this.controllers.delete(controller)
      }
    }
  }

  stop(): void {
    for (const controller of this.controllers) {
      try {
        controller.close()
      } catch {
        // 已关闭。
      }
    }
    this.controllers.clear()
    void this.server?.stop(true)
    this.server = null
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === 'POST' && path === '/v1/code/sessions') {
      return json({ session: { id: SESSION_ID } })
    }
    if (request.method === 'POST' && path === `/v1/code/sessions/${SESSION_ID}/bridge`) {
      return json({ worker_jwt: 'wjwt', api_base_url: this.origin, worker_epoch: 1, expires_in: 3600 })
    }
    if (request.method === 'POST' && path === `/v1/code/sessions/${SESSION_ID}/worker/events`) {
      const body = await readJson(request)
      if (Array.isArray(body)) for (const event of body) if (isRecord(event)) this.events.push(event)
      return json({ status: 'ok', count: this.events.length })
    }
    if (request.method === 'PUT' && path === `/v1/code/sessions/${SESSION_ID}/worker`) {
      const body = await readJson(request)
      if (isRecord(body)) {
        this.statuses.push({ status: String(body.worker_status ?? ''), details: body.requires_action_details ?? null })
      }
      return json({ status: 'ok' })
    }
    if (request.method === 'POST' && path === `/v1/code/sessions/${SESSION_ID}/worker/heartbeat`) {
      this.heartbeats += 1
      return json({ status: 'ok' })
    }
    if (request.method === 'GET' && path === `/v1/code/sessions/${SESSION_ID}/worker/events/stream`) {
      return new Response(this.openStream(), { headers: { 'content-type': 'text/event-stream' } })
    }
    return json({ error: `unhandled ${request.method} ${path}` }, 404)
  }

  private openStream(): ReadableStream<Uint8Array> {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    return new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c
        this.controllers.add(c)
        for (const bytes of this.pending) {
          try {
            c.enqueue(bytes)
          } catch {
            // 忽略。
          }
        }
        this.pending = []
      },
      cancel: () => {
        if (controller) this.controllers.delete(controller)
      },
    })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function waitFor<T>(probe: () => T | undefined, label: string, timeoutMs = 4000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = probe()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('dsh-bridge integration', () => {
  let rcs: FakeRcs
  let bridge: Bridge
  let dir: string
  let logPath: string

  const readLog = (): Record<string, unknown>[] => {
    if (!existsSync(logPath)) return []
    const text = readFileSync(logPath, 'utf8').trim()
    if (!text) return []
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }

  const logKind = (kind: string): Record<string, unknown> | undefined => readLog().find((entry) => entry.kind === kind)

  const config = (): BridgeConfig => ({
    rcsBaseUrl: rcs.origin,
    apiKey: 'test-key',
    workdir: dir,
    title: 'integration',
    provider: 'test-provider',
    model: 'test-model',
    dsh: { command: process.execPath, args: [join(import.meta.dir, 'fixtures', 'fake-dsh.mjs')], cwd: dir },
  })

  beforeEach(async () => {
    rcs = new FakeRcs()
    rcs.start()
    dir = mkdtempSync(join(tmpdir(), 'dsh-bridge-'))
    logPath = join(dir, 'dsh.log')
    process.env.FAKE_DSH_LOG = logPath
    bridge = await startBridge(config())
  })

  afterEach(async () => {
    await bridge.stop()
    rcs.stop()
    delete process.env.FAKE_DSH_LOG
    rmSync(dir, { recursive: true, force: true })
  })

  test('attaches with a heartbeat and idle status', async () => {
    expect(bridge.sessionId).toBe(SESSION_ID)
    await waitFor(() => (rcs.heartbeats > 0 ? true : undefined), 'first heartbeat')
    await waitFor(() => (rcs.statuses.some((entry) => entry.status === 'idle') ? true : undefined), 'idle status')
  }, 15000)

  test('a prompt fans out to assistant, tool_use, tool_result and result', async () => {
    rcs.push({ type: 'user', message: { role: 'user', content: 'hello' } })

    const assistant = await waitFor(() => rcs.events.find((event) => event.type === 'assistant'), 'assistant event')
    expect(assistant.message).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'hello from fake dsh' }],
    })

    const toolUse = await waitFor(() => rcs.events.find((event) => event.type === 'tool_use'), 'tool_use event')
    expect(toolUse).toMatchObject({ tool_call_id: 'call_1', tool_name: 'bash', tool_input: { command: 'echo hi' } })

    const toolResult = await waitFor(() => rcs.events.find((event) => event.type === 'user'), 'tool_result event')
    expect(toolResult.message).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_1',
          content: [{ type: 'text', text: 'hi' }],
          is_error: false,
        },
      ],
    })

    const result = await waitFor(() => rcs.events.find((event) => event.type === 'result'), 'result event')
    expect(result).toMatchObject({ subtype: 'success' })

    expect(rcs.statuses.some((entry) => entry.status === 'running')).toBe(true)
    expect(logKind('prompt')).toMatchObject({ text: 'hello', sessionId: SESSION_ID })
  }, 15000)

  test('unwraps the real gateway worker envelope', async () => {
    rcs.pushEnvelope('user', {
      type: 'user',
      uuid: 'u-env',
      message: { role: 'user', content: 'hello envelope' },
    })

    const assistant = await waitFor(() => rcs.events.find((event) => event.type === 'assistant'), 'assistant event')
    expect(assistant.message).toMatchObject({ role: 'assistant' })
    expect(logKind('prompt')).toMatchObject({ text: 'hello envelope' })
  }, 15000)

  test('approval round-trips as a permission card and an allowed-once outcome', async () => {
    rcs.push({ type: 'user', message: { role: 'user', content: 'approval please' } })

    const card = await waitFor(
      () => rcs.events.find((event) => event.type === 'control_request' && isRecord(event.request)),
      'approval card',
    )
    expect(card.request).toMatchObject({ subtype: 'can_use_tool', tool_name: 'bash' })
    expect(card.request_id).toBeTruthy()

    await waitFor(
      () =>
        rcs.statuses.some(
          (entry) =>
            entry.status === 'requires_action' && isRecord(entry.details) && entry.details.tool_name === 'bash',
        )
          ? true
          : undefined,
      'requires_action status',
    )

    rcs.push({
      type: 'control_response',
      response: { subtype: 'success', request_id: card.request_id, response: { behavior: 'allow' } },
    })

    const outcome = await waitFor(() => logKind('approval-outcome'), 'approval outcome', 4000)
    expect(outcome.outcome).toBe('allowed-once')
    await waitFor(() => rcs.events.find((event) => event.type === 'result'), 'result after approval')
  }, 15000)

  test('a plan-review question becomes an ExitPlanMode card and approves', async () => {
    rcs.push({ type: 'user', message: { role: 'user', content: 'question please' } })

    const card = await waitFor(
      () => rcs.events.find((event) => event.type === 'control_request' && isRecord(event.request)),
      'question card',
    )
    expect(card.request).toMatchObject({
      tool_name: 'ExitPlanMode',
      input: { plan: '# Plan\n\n1. fake step' },
    })

    rcs.push({
      type: 'control_response',
      response: { subtype: 'success', request_id: card.request_id, response: { behavior: 'allow' } },
    })

    const answered = await waitFor(() => logKind('question-answer'), 'question answer', 4000)
    expect(answered.answer).toEqual({ answers: [{ id: 'plan-review', selected: ['Approve'] }] })
  }, 15000)

  test('interrupt synthesizes an aborted result and the next prompt resumes', async () => {
    rcs.push({ type: 'user', message: { role: 'user', content: 'slow turn' } })
    await waitFor(() => (rcs.statuses.some((entry) => entry.status === 'running') ? true : undefined), 'running status')

    rcs.push({ type: 'control_request', request: { subtype: 'interrupt' } })
    const aborted = await waitFor(
      () => rcs.events.find((event) => event.type === 'result' && event.subtype === 'aborted'),
      'aborted result',
    )
    expect(aborted).toMatchObject({ is_error: true, result: 'Interrupted' })

    rcs.push({ type: 'user', message: { role: 'user', content: 'hello again' } })
    await waitFor(() => logKind('resume'), 'session/resume after interrupt', 4000)
    const assistant = await waitFor(
      () => rcs.events.find((event) => event.type === 'assistant'),
      'assistant after resume',
    )
    expect(assistant.message).toMatchObject({ role: 'assistant' })
  }, 20000)
})
