/**
 * Skill 工具正文：技能名与参数；forked 执行额外带一段结果。
 *
 * 结果形状见 CLI `src/tools/SkillTool/SkillTool.ts` 的
 * `mapToolResultToToolResultBlockParam`：内联只有 `Launching skill: <name>`，
 * forked 是 `Skill "<name>" completed (forked execution).\n\nResult:\n…`。
 */

import type { ToolCallData } from '@/lib/session-reducer'
import { canonicalToolName } from '@/lib/tool-summary'

import { formatOutput } from './format'

export interface SkillViewModel {
  name: string
  args: string | null
  forked: boolean
  result: string | null
}

const FORKED_RESULT = /^Skill "([^"]+)" completed \(forked execution\)\.\n\nResult:\n([\s\S]*)$/
const LAUNCHING = /^Launching skill: (\S+)/

export function skillViewModel(tool: ToolCallData): SkillViewModel | null {
  if (canonicalToolName(tool.title) !== 'Skill') return null
  const input = tool.rawInput ?? {}
  const output = formatOutput(tool).trim()
  const forked = output.match(FORKED_RESULT)
  const name = text(input.skill) ?? text(input.command) ?? forked?.[1] ?? output.match(LAUNCHING)?.[1] ?? null
  if (!name) return null
  return {
    name,
    args: text(input.args),
    forked: Boolean(forked),
    result: forked?.[2]?.trim() || null,
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}
