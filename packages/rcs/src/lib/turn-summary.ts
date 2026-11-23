/**
 * 按轮汇总 transcript：给轮尾行提供「工具数 + 耗时」。
 *
 * 计数从最近的 `user_message` 起算，到 `turn_end` 落账；subagent 内部的
 * 工具（`parentToolUseId` 非空）属于子 transcript，不计入本轮。
 */

import type { ThreadEntry } from './session-reducer'

export interface TurnSummary {
  /** 本轮顶层工具调用数。 */
  tools: number
  /** 其中以错误结束的调用数。 */
  errors: number
  durationMs: number
}

/** 以 `turn_end` 的 id 为键，返回每一轮的摘要。 */
export function summarizeTurns(entries: ThreadEntry[]): Map<string, TurnSummary> {
  const summaries = new Map<string, TurnSummary>()
  let tools = 0
  let errors = 0

  for (const entry of entries) {
    if (entry.type === 'user_message') {
      tools = 0
      errors = 0
    } else if (entry.type === 'tool_call') {
      if (entry.parentToolUseId != null) continue
      tools++
      if (entry.toolCall.status === 'error') errors++
    } else if (entry.type === 'turn_end') {
      summaries.set(entry.id, { tools, errors, durationMs: entry.durationMs })
      tools = 0
      errors = 0
    }
  }

  return summaries
}
