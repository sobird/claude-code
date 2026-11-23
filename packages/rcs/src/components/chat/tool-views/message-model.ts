/**
 * 消息类工具正文：Brief（给用户留言）与 SendMessage（发给队友/对端）。
 *
 * 结果形状见 CLI `src/tools/BriefTool/BriefTool.ts`（`Message delivered to user.`）
 * 与 `SendMessageTool.ts` 的 `mapToolResultToToolResultBlockParam`（JSON）。
 */

import type { ToolCallData } from '@/lib/session-reducer'
import { canonicalToolName } from '@/lib/tool-summary'

import { formatOutput } from './format'

export type MessageViewModel =
  | { kind: 'brief'; message: string; attachments: number; delivered: boolean }
  | {
      kind: 'send'
      to: string | null
      summary: string | null
      body: string | null
      success: boolean | null
      result: string | null
      recipients: string[]
    }

const DELIVERED = /^Message delivered to user\./

export function messageViewModel(tool: ToolCallData): MessageViewModel | null {
  const name = canonicalToolName(tool.title)
  const input = tool.rawInput ?? {}
  const output = formatOutput(tool).trim()
  if (name === 'Brief') return briefModel(input, output)
  if (name === 'SendMessage') return sendModel(input, output)
  return null
}

function briefModel(input: Record<string, unknown>, output: string): MessageViewModel | null {
  const message = text(input.message)
  if (!message) return null
  const attachments = Array.isArray(input.attachments) ? input.attachments.length : 0
  return { kind: 'brief', message, attachments, delivered: DELIVERED.test(output) }
}

function sendModel(input: Record<string, unknown>, output: string): MessageViewModel | null {
  const to = text(input.to)
  const summary = text(input.summary)
  const body = bodyOf(input.message)
  const payload = parseJsonRecord(output)
  const success = typeof payload?.success === 'boolean' ? payload.success : null
  const result = payload ? text(payload.message) : output || null
  const recipients = payload && Array.isArray(payload.recipients) ? strings(payload.recipients) : []
  if (!to && !summary && !body && !result) return null
  return { kind: 'send', to, summary, body, success, result, recipients }
}

/** 字符串原样；结构化消息序列化后展示。 */
function bodyOf(value: unknown): string | null {
  if (typeof value === 'string') return text(value)
  if (typeof value === 'object' && value !== null) return JSON.stringify(value, null, 2)
  return null
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  if (!value.startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown[]): string[] {
  return value.filter((item): item is string => typeof item === 'string')
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}
