/**
 * 用于 Web 推送通知的纯函数、运行时中立的辅助工具。
 *
 * 既由网关的通知器服务（服务端）导入，也由服务工作线程的消息类型
 * （浏览器）导入。请保持本模块不依赖仅限服务端或仅限浏览器的导入，
 * 以便两种运行时都能加载它。
 */

import { toWebSessionId } from '@/contracts'

export type PushNotificationKind = 'permission' | 'question' | 'plan'

export interface PushNotificationPayload {
  v: 1
  kind: PushNotificationKind
  sessionId: string
  sessionTitle?: string
  toolName: string
  description?: string
  requestId: string
}

const DEFAULT_WINDOW_MS = 60_000

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 当 payload 请求运行某个工具的 `control_request` 事件时返回 true。 */
export function isConfirmationRequest(type: string, payload: unknown): boolean {
  if (type !== 'control_request') return false
  const record = asRecord(payload)
  if (!record) return false
  const request = asRecord(record.request) ?? record
  return asText(request.subtype) === 'can_use_tool'
}

function notificationKind(toolName: string): PushNotificationKind {
  if (toolName === 'AskUserQuestion') return 'question'
  if (toolName === 'ExitPlanMode') return 'plan'
  return 'permission'
}

/**
 * 为确认请求构建推送到订阅端的载荷；当事件不是确认请求，
 * 或缺少通知所需的标识符时返回 `null`。
 */
export function buildNotificationPayload(
  session: { id: string; title: string | null },
  type: string,
  payload: unknown,
): PushNotificationPayload | null {
  if (!isConfirmationRequest(type, payload)) return null
  const record = asRecord(payload)
  if (!record) return null
  const request = asRecord(record.request) ?? record

  const requestId = asText(record.request_id) || asText(request.request_id)
  const toolName = asText(request.tool_name)
  if (!requestId || !toolName) return null

  const description = asText(request.description)
  const sessionTitle = session.title?.trim() ? session.title : undefined

  return {
    v: 1,
    kind: notificationKind(toolName),
    // 服务工作线程会把它与窗口路径比较并在点击时打开它，两种场景都使用
    // 应用路由所用的面向 Web 的 `session_…` 形式——而不是数据库使用的
    // 规范 `cse_…` id。
    sessionId: toWebSessionId(session.id),
    ...(sessionTitle ? { sessionTitle } : {}),
    toolName,
    ...(description ? { description } : {}),
    requestId,
  }
}

/**
 * 某个 key 首次出现时返回 `true`，之后返回 `false`，直到它空闲超过
 * `windowMs`。每次调用都会淘汰超出窗口的条目。
 */
export function shouldNotifyOnce(
  seen: Map<string, number>,
  key: string,
  now: number,
  windowMs: number = DEFAULT_WINDOW_MS,
): boolean {
  for (const [tracked, timestamp] of seen) {
    if (now - timestamp >= windowMs) seen.delete(tracked)
  }
  if (seen.has(key)) return false
  seen.set(key, now)
  return true
}

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const IPV4_MAPPED_PATTERN = /^::ffff:(.*)$/i
const HEX_GROUP_PATTERN = /^[0-9a-f]{1,4}$/i

/** 回环/私有/链路本地/未指定的 IPv4 网段。 */
function isDisallowedIPv4(host: string): boolean {
  const match = IPV4_PATTERN.exec(host)
  if (!match) return false
  const [a, b, c, d] = match.slice(1).map(Number)
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 0 && b === 0 && c === 0 && d === 0)
  )
}

/**
 * 把 IPv4 映射的 IPv6 主机（`::ffff:…`）中内嵌的 IPv4 解码成点分形式，
 * 同时接受 `127.0.0.1` 和十六进制 `7f00:1` 两种尾部。尾部格式不合法时
 * 返回 `null`，让调用方按失败关闭处理。
 */
function mappedIPv4(remainder: string): string | null {
  if (IPV4_PATTERN.test(remainder)) return remainder
  const groups = remainder.split(':')
  if (groups.length !== 2) return null
  const [hiText, loText] = groups
  if (!HEX_GROUP_PATTERN.test(hiText) || !HEX_GROUP_PATTERN.test(loText)) return null
  const hi = parseInt(hiText, 16)
  const lo = parseInt(loText, 16)
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
}

/** 回环/未指定/唯一本地/链路本地的 IPv6 网段。 */
function isDisallowedIPv6(host: string): boolean {
  if (!host.includes(':')) return false
  const mapped = IPV4_MAPPED_PATTERN.exec(host)
  if (mapped) {
    const ipv4 = mappedIPv4(mapped[1])
    if (ipv4 === null || isDisallowedIPv4(ipv4)) return true
    return false
  }
  return (
    host === '::1' ||
    host === '::' ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe8') ||
    host.startsWith('fe9') ||
    host.startsWith('fea') ||
    host.startsWith('feb')
  )
}

/**
 * 当 `value` 是网关可安全 POST 的推送 endpoint 时返回 true。
 *
 * `web-push` 通过向存储的 endpoint 发起 HTTPS 请求来发送通知，因此未经
 * 校验的值会成为服务端请求伪造（SSRF）的入口：已认证成员可把它指向内网
 * 主机。浏览器推送 endpoint 始终是 443 端口的 HTTPS，所以其他一律拒绝，
 * localhost 以及回环/私有/链路本地的 IP 字面量也一并拒绝。
 *
 * 运行时中立：只用全局 `URL`，以便 worker bundle 加载。
 */
export function isAllowedPushEndpoint(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol !== 'https:') return false
  if (url.port !== '' && url.port !== '443') return false

  const hostname = url.hostname.toLowerCase()
  if (!hostname) return false
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return false

  // `URL.hostname` 会为 IPv6 字面量加上方括号；去掉它们，以便两种形式都检查。
  const host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  if (isDisallowedIPv4(host) || isDisallowedIPv6(host)) return false

  return true
}
