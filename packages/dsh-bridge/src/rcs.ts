import { asNumber, asText, isRecord } from './util'

/** 创建会话与换取 worker 凭据的实现：v2 无环境协议。 */
export interface RcsClientOptions {
  baseUrl: string
  apiKey: string
}

/** bridge 握手返回的 worker 身份；后续事件/状态/心跳都用它的 JWT。 */
export interface WorkerSession {
  sessionId: string
  apiBaseUrl: string
  workerJwt: string
  workerEpoch: number
  /** 本地估算的过期时间；真正的会话期间以 RCS 为准。 */
  expiresAt: number
}

/** worker SSE 的一帧；`sequenceNum` 是续传游标，缺失时不能用于重连。 */
export interface WorkerFrame {
  sequenceNum: number | null
  eventType: string
  payload: Record<string, unknown>
}

export type WorkerStatus = 'idle' | 'running' | 'requires_action'

export interface RequiresActionDetails {
  toolName: string
  description?: string
}

interface RequestInitLike {
  method?: string
  token?: string
  body?: unknown
}

/** RCS 的非 2xx 响应；调用方按 `status` 区分重注册（401）与会话消失（404）。 */
export class RcsHttpError extends Error {
  readonly status: number
  readonly body: string

  constructor(message: string, status: number, body: string) {
    super(message)
    this.name = 'RcsHttpError'
    this.status = status
    this.body = body
  }
}

function parseJson(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** 解析一个 SSE 块（到空行为止）；注释帧（`: keepalive`）返回 null。 */
function parseSseBlock(block: string): { id?: string; event?: string; data: string } | null {
  let id: string | undefined
  let event: string | undefined
  const data: string[] = []
  for (const rawLine of block.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'id') id = value
    else if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  if (data.length === 0) return null
  return { id, event, data: data.join('\n') }
}

export class RcsClient {
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(options: RcsClientOptions) {
    this.baseUrl = options.baseUrl
    this.apiKey = options.apiKey
  }

  private async request(path: string, init: RequestInitLike = {}): Promise<Record<string, unknown>> {
    const method = init.method ?? 'GET'
    const headers: Record<string, string> = { authorization: `Bearer ${init.token ?? this.apiKey}` }
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new RcsHttpError(
        `RCS ${method} ${path} failed: ${response.status} ${text.slice(0, 300)}`,
        response.status,
        text,
      )
    }
    const parsed = parseJson(text)
    return isRecord(parsed) ? parsed : {}
  }

  /** 创建一条 code session，返回 `cse_…` 规范 id；带环境时由 RCS 派发给 worker。 */
  async createSession(title: string | undefined, environmentId?: string): Promise<string> {
    const body = await this.request('/v1/code/sessions', {
      method: 'POST',
      body: {
        ...(title ? { title } : {}),
        ...(environmentId ? { environment_id: environmentId } : {}),
      },
    })
    const session = isRecord(body.session) ? body.session : null
    const id = asText(session?.id)
    if (!id) throw new Error('RCS did not return a session id')
    return id
  }

  /** 换取 worker JWT；`api_base_url` 可能与创建会话的根地址不同。 */
  async openWorker(sessionId: string): Promise<WorkerSession> {
    const body = await this.request(`/v1/code/sessions/${encodeURIComponent(sessionId)}/bridge`, { method: 'POST' })
    const workerJwt = asText(body.worker_jwt)
    if (!workerJwt) throw new Error('RCS did not return a worker token')
    const expiresIn = asNumber(body.expires_in)
    return {
      sessionId,
      apiBaseUrl: asText(body.api_base_url) || this.baseUrl,
      workerJwt,
      workerEpoch: asNumber(body.worker_epoch),
      expiresAt: Date.now() + (expiresIn > 0 ? expiresIn * 1000 : 3_600_000),
    }
  }

  /** 批量上报 bridge 事件；持久化按 uuid 去重，因此重试是安全的。 */
  async postEvents(worker: WorkerSession, events: readonly Record<string, unknown>[]): Promise<void> {
    if (events.length === 0) return
    await this.request(`/v1/code/sessions/${encodeURIComponent(worker.sessionId)}/worker/events`, {
      method: 'POST',
      token: worker.workerJwt,
      body: events,
    })
  }

  /** 写入会话状态；`requires_action` 附带列表要展示的阻塞原因。 */
  async setWorkerStatus(worker: WorkerSession, status: WorkerStatus, details?: RequiresActionDetails): Promise<void> {
    await this.request(`/v1/code/sessions/${encodeURIComponent(worker.sessionId)}/worker`, {
      method: 'PUT',
      token: worker.workerJwt,
      body: {
        worker_status: status,
        requires_action_details:
          status === 'requires_action' && details
            ? {
                tool_name: details.toolName,
                ...(details.description ? { action_description: details.description } : {}),
              }
            : null,
      },
    })
  }

  /** 写入外部元数据（浅合并）；只带该字段，不覆盖 worker 状态。 */
  async setExternalMetadata(worker: WorkerSession, metadata: Record<string, unknown>): Promise<void> {
    await this.request(`/v1/code/sessions/${encodeURIComponent(worker.sessionId)}/worker`, {
      method: 'PUT',
      token: worker.workerJwt,
      body: { external_metadata: metadata },
    })
  }

  async heartbeat(worker: WorkerSession): Promise<void> {
    await this.request(`/v1/code/sessions/${encodeURIComponent(worker.sessionId)}/worker/heartbeat`, {
      method: 'POST',
      token: worker.workerJwt,
    })
  }

  /**
   * 持续读取 worker 出站事件；`fromSequenceNum` 为 0 时不带游标（服务端只重放
   * 最近一窗）。调用方在断线后用自己的最后游标重连。
   */
  async *streamEvents(
    worker: WorkerSession,
    fromSequenceNum: number,
    signal: AbortSignal,
  ): AsyncGenerator<WorkerFrame> {
    const suffix = fromSequenceNum > 0 ? `?from_sequence_num=${fromSequenceNum}` : ''
    const url = `${worker.apiBaseUrl}/v1/code/sessions/${encodeURIComponent(worker.sessionId)}/worker/events/stream${suffix}`
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${worker.workerJwt}`, accept: 'text/event-stream' },
      signal,
    })
    if (!response.ok || !response.body) {
      throw new Error(`RCS worker stream failed: ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        for (;;) {
          const boundary = buffer.indexOf('\n\n')
          if (boundary < 0) break
          const block = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const frame = parseSseBlock(block)
          if (!frame) continue
          const raw = parseJson(frame.data)
          if (!isRecord(raw)) continue
          // 真实网关把事件包在信封里：{event_id, sequence_num, event_type, payload:{…, type}}。
          // 兼容「已经扁平」的帧（假服务器/更老的形状），仅当信封特征存在时才拆。
          const isEnvelope =
            typeof raw.event_type === 'string' ||
            typeof raw.sequence_num === 'number' ||
            typeof raw.event_id === 'string'
          const payload = isEnvelope && isRecord(raw.payload) ? raw.payload : raw
          const sequenceNum =
            isEnvelope && typeof raw.sequence_num === 'number'
              ? raw.sequence_num
              : frame.id
                ? Number.parseInt(frame.id, 10)
                : Number.NaN
          yield {
            sequenceNum: Number.isFinite(sequenceNum) ? sequenceNum : null,
            eventType: asText(raw.event_type) || asText(payload.type) || frame.event || 'message',
            payload,
          }
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  }
}
