import { Buffer } from 'node:buffer'

import { isRecord } from '../util'

/**
 * 进程内假 RCS：只实现独立桥与 dsh 插件用到的会话/worker/事件/SSE 端点。
 * 默认会话 id 为 `cse_test`，需要区分实例时由调用方传入。
 */
export class FakeRcs {
  readonly events: Record<string, unknown>[] = []
  readonly statuses: { status: string; details: unknown }[] = []
  /** 创建会话时收到的请求体。 */
  readonly createdSessions: Record<string, unknown>[] = []
  /** `PUT /worker` 收到的 `external_metadata`。 */
  readonly externalMetadata: Record<string, unknown>[] = []
  /** 环境注册请求体。 */
  readonly environmentRegistrations: Record<string, unknown>[] = []
  /** 设备码配对：`/v1/auth/device/code` 收到的请求体。 */
  readonly deviceCodeRequests: Record<string, unknown>[] = []
  /** 设备码 token 轮询按顺序出队；队空返回 404。 */
  readonly deviceTokenStates: Record<string, unknown>[] = []
  readonly acked: string[] = []
  readonly stopped: string[] = []
  readonly reconnected: string[] = []
  readonly deregistered: string[] = []
  /** 非 null 时下一次 poll 返回该状态码并清空。 */
  nextPollStatus: number | null = null
  heartbeats = 0
  /** bridge 握手（换取 worker JWT）次数；刷新凭据会再握手一次。 */
  bridgeHandshakes = 0
  /** 非 null 时常驻地让环境注册返回该状态码，用于验证重注册失败的分支。 */
  environmentRegisterStatus: number | null = null
  /** `GET /v1/sessions/:id` 返回的标题。 */
  sessionTitle: string | undefined = undefined

  private readonly workQueue: { id: string; sessionId: string }[] = []
  private workSeq = 0
  /** 让创建会话失败，用来验证「复用成功时不会新建」。 */
  failCreate = false
  /** worker JWT 是否已过期：过期后所有 worker 请求 401，直到再次握手换票。 */
  private workerExpired = false

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

  /** 模拟 worker JWT 过期：worker 请求一律 401，再次握手后才恢复。 */
  expireWorker(): void {
    this.workerExpired = true
  }

  /** 往环境工作队列里放一条会话，下一次 poll 会取走。 */
  enqueueWork(sessionId: string): void {
    this.workSeq += 1
    this.workQueue.push({ id: `work_${this.workSeq}`, sessionId })
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
      if (this.failCreate) return json({ error: 'create disabled' }, 500)
      const body = await readJson(request)
      if (isRecord(body)) this.createdSessions.push(body)
      return json({ session: { id: session } })
    }
    if (request.method === 'POST' && path === `/v1/code/sessions/${session}/bridge`) {
      this.bridgeHandshakes += 1
      this.workerExpired = false
      return json({ worker_jwt: 'wjwt', api_base_url: this.origin, worker_epoch: 1, expires_in: 3600 })
    }
    if (request.method === 'GET' && path === `/v1/sessions/${session}`) {
      return json({ id: session, title: this.sessionTitle ?? null })
    }
    if (request.method === 'POST' && path === `/v1/code/sessions/${session}/worker/events`) {
      if (this.workerExpired) return json({ error: 'worker token expired' }, 401)
      const body = await readJson(request)
      if (Array.isArray(body)) for (const event of body) if (isRecord(event)) this.events.push(event)
      return json({ status: 'ok', count: this.events.length })
    }
    if (request.method === 'PUT' && path === `/v1/code/sessions/${session}/worker`) {
      if (this.workerExpired) return json({ error: 'worker token expired' }, 401)
      const body = await readJson(request)
      if (isRecord(body)) {
        if (typeof body.worker_status === 'string') {
          this.statuses.push({ status: body.worker_status, details: body.requires_action_details ?? null })
        }
        if (isRecord(body.external_metadata)) this.externalMetadata.push(body.external_metadata)
      }
      return json({ status: 'ok' })
    }
    if (request.method === 'POST' && path === `/v1/code/sessions/${session}/worker/heartbeat`) {
      if (this.workerExpired) return json({ error: 'worker token expired' }, 401)
      this.heartbeats += 1
      return json({ status: 'ok' })
    }
    if (request.method === 'GET' && path === `/v1/code/sessions/${session}/worker/events/stream`) {
      if (this.workerExpired) return json({ error: 'worker token expired' }, 401)
      return new Response(this.openStream(), { headers: { 'content-type': 'text/event-stream' } })
    }

    if (request.method === 'POST' && path === '/v1/auth/device/code') {
      const body = await readJson(request)
      if (isRecord(body)) this.deviceCodeRequests.push(body)
      return json({
        device_code: 'device-code-1234567890abcdef',
        user_code: 'ABCD-2345',
        verification_uri: 'https://rcs.example.com/device',
        verification_uri_complete: 'https://rcs.example.com/device#code=ABCD-2345',
        expires_in: 600,
        interval: 5,
      })
    }
    if (request.method === 'POST' && path === '/v1/auth/device/token') {
      const next = this.deviceTokenStates.shift()
      if (!next) return json({ error: 'unknown device code' }, 404)
      return json(next)
    }

    if (request.method === 'POST' && path === '/v1/environments/bridge') {
      if (this.environmentRegisterStatus !== null) {
        return json({ error: `register failed ${this.environmentRegisterStatus}` }, this.environmentRegisterStatus)
      }
      const body = await readJson(request)
      if (isRecord(body)) this.environmentRegistrations.push(body)
      return json({ environment_id: 'env_test', environment_secret: 'env_secret', status: 'active' })
    }
    const deregister = path.match(/^\/v1\/environments\/bridge\/([^/]+)$/)
    if (request.method === 'DELETE' && deregister) {
      this.deregistered.push(deregister[1])
      return json({ status: 'ok' })
    }
    const reconnect = path.match(/^\/v1\/environments\/([^/]+)\/bridge\/reconnect$/)
    if (request.method === 'POST' && reconnect) {
      this.reconnected.push(reconnect[1])
      return json({ status: 'ok' })
    }
    const poll = path.match(/^\/v1\/environments\/([^/]+)\/work\/poll$/)
    if (request.method === 'GET' && poll) {
      if (this.nextPollStatus !== null) {
        const status = this.nextPollStatus
        this.nextPollStatus = null
        return json({ error: `poll failed ${status}` }, status)
      }
      const next = this.workQueue.shift()
      if (!next) return new Response(null, { status: 204 })
      const secret = Buffer.from(
        JSON.stringify({
          version: 1,
          session_ingress_token: 'work-jwt',
          api_base_url: this.origin,
          sources: [],
          auth: [],
          use_code_sessions: false,
        }),
      ).toString('base64url')
      return json({
        id: next.id,
        type: 'work',
        environment_id: poll[1],
        state: 'dispatched',
        data: { type: 'session', id: next.sessionId },
        secret,
        created_at: new Date().toISOString(),
      })
    }
    const workAction = path.match(/^\/v1\/environments\/([^/]+)\/work\/([^/]+)\/(ack|stop|heartbeat)$/)
    if (request.method === 'POST' && workAction) {
      const [, , workId, action] = workAction
      if (action === 'ack') this.acked.push(workId)
      if (action === 'stop') this.stopped.push(workId)
      return json({ status: 'ok', lease_extended: true, state: 'dispatched', ttl_seconds: 300 })
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
