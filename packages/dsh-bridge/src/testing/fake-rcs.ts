import { isRecord } from '../util'

/**
 * 进程内假 RCS：只实现独立桥与 dsh 插件用到的会话/worker/事件/SSE 端点。
 * 默认会话 id 为 `cse_test`，需要区分实例时由调用方传入。
 */
export class FakeRcs {
  readonly events: Record<string, unknown>[] = []
  readonly statuses: { status: string; details: unknown }[] = []
  heartbeats = 0

  private readonly sessionId: string
  private seq = 0
  private readonly controllers = new Set<ReadableStreamDefaultController<Uint8Array>>()
  private pending: Uint8Array[] = []
  private server: ReturnType<typeof Bun.serve> | null = null

  constructor(sessionId = 'cse_test') {
    this.sessionId = sessionId
  }

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

  /** 往 worker SSE 推一帧出站事件（相当于 RCS 下发给客户端）。 */
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

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const session = this.sessionId

    if (request.method === 'POST' && path === '/v1/code/sessions') {
      return json({ session: { id: session } })
    }
    if (request.method === 'POST' && path === `/v1/code/sessions/${session}/bridge`) {
      return json({ worker_jwt: 'wjwt', api_base_url: this.origin, worker_epoch: 1, expires_in: 3600 })
    }
    if (request.method === 'POST' && path === `/v1/code/sessions/${session}/worker/events`) {
      const body = await readJson(request)
      if (Array.isArray(body)) for (const event of body) if (isRecord(event)) this.events.push(event)
      return json({ status: 'ok', count: this.events.length })
    }
    if (request.method === 'PUT' && path === `/v1/code/sessions/${session}/worker`) {
      const body = await readJson(request)
      if (isRecord(body)) {
        this.statuses.push({ status: String(body.worker_status ?? ''), details: body.requires_action_details ?? null })
      }
      return json({ status: 'ok' })
    }
    if (request.method === 'POST' && path === `/v1/code/sessions/${session}/worker/heartbeat`) {
      this.heartbeats += 1
      return json({ status: 'ok' })
    }
    if (request.method === 'GET' && path === `/v1/code/sessions/${session}/worker/events/stream`) {
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

/** 轮询直到 probe 返回非 undefined；用于等待异步事件出现在假服务器上。 */
export async function waitFor<T>(probe: () => T | undefined, label: string, timeoutMs = 4000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = probe()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
