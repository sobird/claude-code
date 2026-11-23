import type { ToolCallData } from '@/lib/session-reducer'

import { firstString, formatOutput } from './format'

export interface SearchViewModel {
  pattern: string
  path: string
  glob: string
  output: string
  errored: boolean
}

/** 提取搜索卡片所需的模式与范围；缺少模式时返回 `null` 以便回退到通用正文。 */
export function searchViewModel(tool: ToolCallData): SearchViewModel | null {
  const input = tool.rawInput ?? {}
  const pattern = firstString(input.pattern)
  if (!pattern) return null
  return {
    pattern,
    path: firstString(input.path),
    glob: firstString(input.glob),
    output: formatOutput(tool),
    errored: tool.status === 'error',
  }
}
