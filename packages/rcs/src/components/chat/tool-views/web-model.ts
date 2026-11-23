import type { ToolCallData } from '@/lib/session-reducer'

import { firstString, formatOutput } from './format'

export interface WebViewModel {
  /** WebFetch 的地址；WebSearch 为空。 */
  url: string
  query: string
  output: string
  errored: boolean
}

/** 只放行 http(s) 链接，避免把模型给出的任意 scheme 渲染成可点击锚点。 */
export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

/** 提取网页卡片所需的地址或查询词；两者皆无时返回 `null` 以便回退到通用正文。 */
export function webViewModel(tool: ToolCallData): WebViewModel | null {
  const input = tool.rawInput ?? {}
  const url = firstString(input.url)
  const query = firstString(input.query)
  if (!url && !query) return null
  return { url, query, output: formatOutput(tool), errored: tool.status === 'error' }
}
