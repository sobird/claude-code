/**
 * 首次启动的凭据编排：已有凭据直接复用，否则走设备码配对并落盘。
 *
 * 配对发生在 `apply()` 内、阻塞到批准或超时（最长 `expires_in`）；headless 场景应
 * 显式设置 `RCS_API_KEY` 跳过这一步。所有提示走注入的 `log`（实际为 stderr）。
 */

import { hostname as osHostname } from 'node:os'

import { stripTrailingSlash } from '@sobird/dsh-bridge/core'

import { readCredentials, writeCredentials } from './credentials'
import type { DeviceGrant, DeviceTokenResult } from './device-auth'

/** `DeviceAuthClient` 的最小接口；测试用普通对象，生产用真实客户端。 */
export interface DeviceAuthLike {
  requestCode(input: { client: string; hostname?: string }): Promise<DeviceGrant>
  pollToken(deviceCode: string): Promise<DeviceTokenResult>
}

export interface EnsureCredentialsOptions {
  stateDir: string
  client: DeviceAuthLike
  openUrl: (url: string) => void
  log: (line: string) => void
  /** 忽略已存凭据，重新配对（`/rcs-login`）。 */
  force?: boolean
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const CLIENT_NAME = 'dsh-rcs-plugin'

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 返回可用的 API key：文件命中、批准后落盘，或超时抛出。 */
export async function ensureCredentials(
  connection: { rcsBaseUrl: string },
  options: EnsureCredentialsOptions,
): Promise<string> {
  const baseUrl = stripTrailingSlash(connection.rcsBaseUrl)

  if (!options.force) {
    const stored = await readCredentials(options.stateDir)
    if (stored && stripTrailingSlash(stored.rcsBaseUrl) === baseUrl) return stored.apiKey
  }

  const grant = await options.client.requestCode({ client: CLIENT_NAME, hostname: osHostname() })
  options.log(`pairing: open ${grant.verificationUri}`)
  options.log(`pairing: enter code ${grant.userCode}`)
  try {
    options.openUrl(grant.verificationUri)
  } catch {
    // 打不开浏览器不影响配对：URL 已打印。
  }

  const now = options.now ?? Date.now
  const sleep = options.sleep ?? defaultSleep
  const deadline = now() + grant.expiresIn * 1000

  while (now() < deadline) {
    const result = await options.client.pollToken(grant.deviceCode)
    if (result.status === 'approved') {
      await writeCredentials(options.stateDir, {
        version: 1,
        rcsBaseUrl: baseUrl,
        apiKey: result.apiKey,
        createdAt: new Date(now()).toISOString(),
      })
      options.log('pairing: paired')
      return result.apiKey
    }
    if (result.status === 'expired') {
      throw new Error('rcs-bridge: pairing code expired — run /rcs-login to try again')
    }
    await sleep(grant.interval * 1000)
  }

  throw new Error('rcs-bridge: pairing timed out — run /rcs-login to try again')
}
