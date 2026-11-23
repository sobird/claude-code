/**
 * Agent（历史别名 task）正文：子代理类型、用量、prompt 与剥离追踪尾注后的报告。
 *
 * CLI 在 completed 结果末尾追加 `agentId: …` 行和 `<usage>` 块，一次性内置代理
 * （Explore/Plan）则不带；异步/远程/团队启动返回的是启动说明而非最终报告。
 */

import type { ToolCallData } from '@/lib/session-reducer'

import { formatOutput } from './format'

export interface AgentUsage {
  totalTokens: number
  toolUses: number
  durationMs: number
}

export interface AgentViewModel {
  description: string | null
  subagentType: string | null
  prompt: string | null
  usage: AgentUsage | null
  /** 已剥离 agentId / worktree / `<usage>` 尾注的报告正文。 */
  output: string
  errored: boolean
  /** 异步、远程或团队启动：结果不是最终报告。 */
  launched: boolean
}

/** 不是最终报告的启动结果开头（与 `src/tools/AgentTool/AgentTool.tsx` 一致）。 */
const LAUNCHED_PREFIXES = ['Async agent launched', 'Remote agent launched', 'Spawned successfully']

const USAGE_BLOCK = /<usage>([\s\S]*?)<\/usage>/
/** 报告之后的追踪尾注：agentId 行，可能再跟 worktreePath/worktreeBranch 两行。 */
const TRAILER = /\nagentId: [^\n]*(?:\nworktree(?:Path|Branch): [^\n]*)*$/

export function agentViewModel(tool: ToolCallData): AgentViewModel {
  const raw = formatOutput(tool)
  const launched = LAUNCHED_PREFIXES.some((prefix) => raw.trimStart().startsWith(prefix))
  const { usage, output } = launched ? { usage: null, output: raw } : stripTrailer(raw)
  return {
    description: textField(tool.rawInput?.description),
    subagentType: textField(tool.rawInput?.subagent_type),
    prompt: textField(tool.rawInput?.prompt),
    usage,
    output,
    errored: tool.status === 'error',
    launched,
  }
}

/** 毫秒 → `800ms` / `1.5s` / `65s`；10 秒以上不再显示小数。 */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  const text = seconds >= 10 ? String(Math.round(seconds)) : seconds.toFixed(1).replace(/\.0$/, '')
  return `${text}s`
}

function stripTrailer(raw: string): { usage: AgentUsage | null; output: string } {
  const match = raw.match(USAGE_BLOCK)
  // 没有 usage 块就是完整报告（一次性内置代理），原样返回。
  if (!match || match.index === undefined) return { usage: null, output: raw }
  const usage = parseUsage(match[1] ?? '')
  const output = raw.slice(0, match.index).trimEnd().replace(TRAILER, '').trimEnd()
  return { usage, output }
}

function parseUsage(block: string): AgentUsage | null {
  const totalTokens = numberIn(block, 'total_tokens')
  const toolUses = numberIn(block, 'tool_uses')
  const durationMs = numberIn(block, 'duration_ms')
  if (totalTokens === null || toolUses === null || durationMs === null) return null
  return { totalTokens, toolUses, durationMs }
}

function numberIn(block: string, key: string): number | null {
  const match = block.match(new RegExp(`${key}:\\s*(\\d+)`))
  return match ? Number(match[1]) : null
}

function textField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}
