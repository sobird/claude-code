/**
 * 服务工作线程用来把推送载荷转成本地化通知的纯函数。
 * 运行时中立：不引入仅限服务端或仅限 DOM 的依赖，
 * 因此可由 worker bundle 加载。
 */
import { CATALOGS } from '@/i18n/catalogs'

import type { PushNotificationKind, PushNotificationPayload } from './push-payload.js'

export interface NotificationContent {
  title: string
  body: string
  tag: string
  url: string
}

/**
 * 超过该长度的会话标题会被截断，以免通知难以阅读。
 * 按 Unicode 码点计数（通过 `Array.from`），而非 UTF-16 码元。
 */
export const MAX_TITLE_LENGTH = 60

const KINDS = new Set<PushNotificationKind>(['permission', 'question', 'plan'])

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** 对推送载荷做结构校验；任何格式不合规的输入返回 `null`。 */
export function parseNotificationPayload(value: unknown): PushNotificationPayload | null {
  const record = asRecord(value)
  if (!record) return null
  if (record.v !== 1) return null

  const { kind, sessionId, toolName, requestId, sessionTitle, description } = record
  if (typeof kind !== 'string' || !KINDS.has(kind as PushNotificationKind)) return null
  if (typeof sessionId !== 'string' || !sessionId) return null
  if (typeof toolName !== 'string' || !toolName) return null
  if (typeof requestId !== 'string' || !requestId) return null
  if (sessionTitle !== undefined && typeof sessionTitle !== 'string') return null
  if (description !== undefined && typeof description !== 'string') return null

  return {
    v: 1,
    kind: kind as PushNotificationKind,
    sessionId,
    ...(typeof sessionTitle === 'string' ? { sessionTitle } : {}),
    toolName,
    ...(typeof description === 'string' ? { description } : {}),
    requestId,
  }
}

function truncateTitle(title: string): string {
  // 按码点计数，避免星际平面字符（emoji、生僻 CJK）在边界处
  // 被拆成孤立的代理项。
  const chars = Array.from(title)
  return chars.length > MAX_TITLE_LENGTH ? `${chars.slice(0, MAX_TITLE_LENGTH).join('')}…` : title
}

/** 本地化的标题/正文，加上去重标签与点击跳转 URL。 */
export function toNotificationContent(payload: PushNotificationPayload, locale: 'en' | 'zh-CN'): NotificationContent {
  const copy = CATALOGS[locale].notifications
  const sessionTitle = payload.sessionTitle?.trim()
  const title = sessionTitle ? truncateTitle(sessionTitle) : copy.title
  return {
    title,
    body: copy[payload.kind].replace('{tool}', () => payload.toolName),
    tag: `session:${payload.sessionId}:${payload.requestId}`,
    url: `/${payload.sessionId}`,
  }
}

/** 当某个可见客户端已在展示该会话时返回 false。 */
export function shouldShowNotification(visiblePaths: string[], sessionId: string): boolean {
  return !visiblePaths.includes(`/${sessionId}`)
}
