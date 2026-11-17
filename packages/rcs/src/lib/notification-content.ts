/**
 * Pure helpers the service worker uses to turn a pushed payload into a
 * localized notification. Runtime-neutral: no server-only or DOM-only imports,
 * so it can be loaded by the worker bundle.
 */
import { CATALOGS } from '../i18n/catalogs.js'
import type { PushNotificationKind, PushNotificationPayload } from './push-payload.js'

export interface NotificationContent {
  title: string
  body: string
  tag: string
  url: string
}

/**
 * Session titles longer than this are clipped so the notification stays readable.
 * Counts Unicode code points (via `Array.from`), not UTF-16 code units.
 */
export const MAX_TITLE_LENGTH = 60

const KINDS = new Set<PushNotificationKind>(['permission', 'question', 'plan'])

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** Structural validation of a pushed payload; `null` for anything malformed. */
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
  // Count code points so an astral character (emoji, rare CJK) is not split
  // into a lone surrogate at the boundary.
  const chars = Array.from(title)
  return chars.length > MAX_TITLE_LENGTH ? `${chars.slice(0, MAX_TITLE_LENGTH).join('')}…` : title
}

/** Localized title/body plus the dedupe tag and click-through URL. */
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

/** False when a visible client is already showing that session. */
export function shouldShowNotification(visiblePaths: string[], sessionId: string): boolean {
  return !visiblePaths.includes(`/${sessionId}`)
}
