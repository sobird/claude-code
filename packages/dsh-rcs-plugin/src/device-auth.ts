/**
 * 设备码配对客户端：向公开端点申请设备码并轮询到批准，全程无需 Authorization。
 *
 * 网络层可注入，测试用 FakeRcs 或自建 fetch；非 2xx 抛 `DeviceAuthError`（带 status），
 * 让编排层能区分「网络失败」「未知码」与「已过期」。
 */

import { asText, isRecord, stripTrailingSlash } from '@sobird/dsh-bridge/core'

export type DeviceFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Response>

export interface DeviceGrant {
  deviceCode: string
  userCode: string
  verificationUri: string
  /** 带 `#code=` 的快捷链接；旧服务端不下发时回退为 `verificationUri`。 */
  verificationUriComplete: string
  expiresIn: number
  interval: number
}

export type DeviceTokenResult =
  | { status: 'pending' | 'expired'; apiKey: undefined }
  | { status: 'approved'; apiKey: string }

export class DeviceAuthError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'DeviceAuthError'
    this.status = status
  }
}

export interface DeviceAuthOptions {
  baseUrl: string
  fetch?: DeviceFetch
}

const DEFAULT_EXPIRES_IN = 600
const DEFAULT_INTERVAL = 5

function asInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export class DeviceAuthClient {
  private readonly baseUrl: string
  private readonly fetchImpl: DeviceFetch

  constructor(options: DeviceAuthOptions) {
    this.baseUrl = stripTrailingSlash(options.baseUrl)
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  /** POST /v1/auth/device/code — 申请设备码与用户短码。 */
  async requestCode(input: { client: string; hostname?: string }): Promise<DeviceGrant> {
    const response = await this.post('/v1/auth/device/code', input)
    if (!response.ok) throw new DeviceAuthError(response.status, `device code request failed: ${response.status}`)

    const body: unknown = await response.json()
    if (!isRecord(body)) throw new DeviceAuthError(response.status, 'invalid device code response')

    const verificationUri = asText(body.verification_uri)
    return {
      deviceCode: asText(body.device_code),
      userCode: asText(body.user_code),
      verificationUri,
      verificationUriComplete: asText(body.verification_uri_complete) || verificationUri,
      expiresIn: asInt(body.expires_in, DEFAULT_EXPIRES_IN),
      interval: asInt(body.interval, DEFAULT_INTERVAL),
    }
  }

  /** POST /v1/auth/device/token — 轮询状态；批准后返回一次性 key。 */
  async pollToken(deviceCode: string): Promise<DeviceTokenResult> {
    const response = await this.post('/v1/auth/device/token', { device_code: deviceCode })
    if (!response.ok) throw new DeviceAuthError(response.status, `device token poll failed: ${response.status}`)

    const body: unknown = await response.json()
    if (!isRecord(body)) throw new DeviceAuthError(response.status, 'invalid device token response')

    const status = asText(body.status)
    if (status === 'approved') {
      const apiKey = asText(body.api_key)
      if (!apiKey) throw new DeviceAuthError(response.status, 'approved without api_key')
      return { status, apiKey }
    }
    if (status === 'pending' || status === 'expired') return { status, apiKey: undefined }
    throw new DeviceAuthError(response.status, `unexpected device token status "${status}"`)
  }

  private post(path: string, body: unknown): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }
}
