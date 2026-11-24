import { Buffer } from 'node:buffer'

import { RcsHttpError, type WorkerSession } from './rcs'
import { asText, isRecord } from './util'

/** 环境注册结果；`environmentSecret` 是短期的环境 token，只用于 poll/ack/heartbeat/stop。 */
export interface EnvironmentRegistration {
  environmentId: string
  environmentSecret: string
}

/** 一条派发到本环境的工作；`secret` 是 base64url 的会话凭据。 */
export interface WorkItem {
  id: string
  environmentId: string
  sessionId: string
  secret: string
  state: string
}

export interface RcsEnvironmentClientOptions {
  baseUrl: string
  apiKey: string
}

export interface RegisterEnvironmentInput {
  environmentId?: string
  machineName?: string
  directory?: string
  maxSessions?: number
  workerType?: string
}

export interface PollOptions {
  timeoutSeconds?: number
  reclaimOlderThanMs?: number
  signal?: AbortSignal
}

interface RequestInitLike {
  method?: string
  token?: string
  body?: unknown
  signal?: AbortSignal
}

function parseJson(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** 环境 worker 协议：注册、长轮询取工作、ack/heartbeat/stop 与重连/注销。 */
export class RcsEnvironmentClient {
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(options: RcsEnvironmentClientOptions) {
    this.baseUrl = options.baseUrl
    this.apiKey = options.apiKey
  }

  private async send(path: string, init: RequestInitLike = {}): Promise<{ status: number; text: string }> {
    const method = init.method ?? 'GET'
    const headers: Record<string, string> = { authorization: `Bearer ${init.token ?? this.apiKey}` }
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      ...(init.signal ? { signal: init.signal } : {}),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new RcsHttpError(
        `RCS ${method} ${path} failed: ${response.status} ${text.slice(0, 300)}`,
        response.status,
        text,
      )
    }
    return { status: response.status, text }
  }

  /** 注册（或带旧 id 重注册）环境，返回新的环境凭据。 */
  async register(input: RegisterEnvironmentInput = {}): Promise<EnvironmentRegistration> {
    const body = {
      ...(input.environmentId ? { environment_id: input.environmentId } : {}),
      ...(input.machineName ? { machine_name: input.machineName } : {}),
      ...(input.directory ? { directory: input.directory } : {}),
      ...(input.maxSessions !== undefined ? { max_sessions: input.maxSessions } : {}),
      ...(input.workerType ? { metadata: { worker_type: input.workerType } } : {}),
    }
    const { text } = await this.send('/v1/environments/bridge', { method: 'POST', body })
    const parsed = parseJson(text)
    const record = isRecord(parsed) ? parsed : {}
    const environmentId = asText(record.environment_id)
    const environmentSecret = asText(record.environment_secret)
    if (!environmentId || !environmentSecret) throw new Error('RCS did not return environment credentials')
    return { environmentId, environmentSecret }
  }

  /** 长轮询下一条工作；204 表示暂时没有（正常状态）。 */
  async poll(environmentId: string, environmentSecret: string, options: PollOptions = {}): Promise<WorkItem | null> {
    const params = new URLSearchParams()
    params.set('timeout', String(options.timeoutSeconds ?? 30))
    params.set('reclaim_older_than_ms', String(options.reclaimOlderThanMs ?? 5_000))
    const path = `/v1/environments/${encodeURIComponent(environmentId)}/work/poll?${params.toString()}`
    const { status, text } = await this.send(path, { token: environmentSecret, signal: options.signal })
    if (status === 204) return null
    const parsed = parseJson(text)
    const record = isRecord(parsed) ? parsed : {}
    const data = isRecord(record.data) ? record.data : null
    const id = asText(record.id)
    const sessionId = asText(data?.id)
    const secret = asText(record.secret)
    if (!id || !sessionId || !secret) throw new Error('RCS returned an invalid work item')
    return {
      id,
      environmentId: asText(record.environment_id) || environmentId,
      sessionId,
      secret,
      state: asText(record.state),
    }
  }

  /** ack 接受 worker token 或环境 token。 */
  async ack(environmentId: string, workId: string, token: string): Promise<void> {
    await this.send(`/v1/environments/${encodeURIComponent(environmentId)}/work/${encodeURIComponent(workId)}/ack`, {
      method: 'POST',
      token,
    })
  }

  async heartbeat(environmentId: string, workId: string, token: string): Promise<void> {
    await this.send(
      `/v1/environments/${encodeURIComponent(environmentId)}/work/${encodeURIComponent(workId)}/heartbeat`,
      { method: 'POST', token },
    )
  }

  /** 停止工作只认环境 token。 */
  async stop(environmentId: string, workId: string, environmentSecret: string): Promise<void> {
    await this.send(`/v1/environments/${encodeURIComponent(environmentId)}/work/${encodeURIComponent(workId)}/stop`, {
      method: 'POST',
      token: environmentSecret,
    })
  }

  /** 重排该环境下的 idle 会话（重启后恢复已 ack 的桥）。 */
  async reconnect(environmentId: string): Promise<void> {
    await this.send(`/v1/environments/${encodeURIComponent(environmentId)}/bridge/reconnect`, { method: 'POST' })
  }

  /** 卸载时注销环境；用用户 API key。 */
  async deregister(environmentId: string): Promise<void> {
    await this.send(`/v1/environments/bridge/${encodeURIComponent(environmentId)}`, { method: 'DELETE' })
  }
}

/** work secret 只带 worker token 与 API 根地址；版本/来源字段目前不用。 */
export function parseWorkSecret(secret: string): { sessionIngressToken: string; apiBaseUrl: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(secret, 'base64url').toString('utf8'))
  } catch {
    throw new Error('work secret is not valid base64url JSON')
  }
  const record = isRecord(parsed) ? parsed : {}
  const sessionIngressToken = asText(record.session_ingress_token)
  if (!sessionIngressToken) throw new Error('work secret is missing session_ingress_token')
  return { sessionIngressToken, apiBaseUrl: asText(record.api_base_url) }
}

/**
 * work secret 不带 TTL，`expiresAt` 只作本地占位；真正的过期由上报 401 换票兜底。
 */
export function toWorkerSession(item: WorkItem, fallbackBaseUrl: string): WorkerSession {
  const parsed = parseWorkSecret(item.secret)
  return {
    sessionId: item.sessionId,
    apiBaseUrl: parsed.apiBaseUrl || fallbackBaseUrl,
    workerJwt: parsed.sessionIngressToken,
    workerEpoch: 1,
    expiresAt: Date.now() + 3_600_000,
  }
}
