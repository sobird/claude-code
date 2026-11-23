/**
 * 会话活动清单的客户端解析。
 *
 * 归档被拒时网关返回 `409 session_active`，并把占用项放在 `error.details.activity`。
 * 这里只做形状校验；不是该错误或载荷畸形时返回 `null`/`[]`，让调用方降级到普通
 * 错误提示，而不是弹出空的活动列表。
 */

import { ApiError } from '@/lib/api-client'

export interface SessionActivityItem {
  kind: string
  id?: string
  label: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toActivityItem(value: unknown): SessionActivityItem | null {
  if (!isRecord(value)) return null
  if (typeof value.kind !== 'string' || typeof value.label !== 'string') return null
  return typeof value.id === 'string'
    ? { kind: value.kind, id: value.id, label: value.label }
    : { kind: value.kind, label: value.label }
}

/** 仅当 error 是 `session_active` 的 `ApiError` 时返回活动清单；否则 `null`。 */
export function readSessionActivity(error: unknown): SessionActivityItem[] | null {
  if (!(error instanceof ApiError) || error.code !== 'session_active') return null
  const details = error.details
  if (!isRecord(details) || !Array.isArray(details.activity)) return []
  return details.activity.map(toActivityItem).filter((item): item is SessionActivityItem => item !== null)
}
