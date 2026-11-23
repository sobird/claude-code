import type { ToolCallData } from '@/lib/session-reducer'

/** 原始输入 JSON 的展示上限（输出文本不再截断）。 */
export const OUTPUT_LIMIT = 2000

/** 超过该行数的输出默认折叠，由用户展开查看全文。 */
export const OUTPUT_MAX_LINES = 15

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

/** 输出行数超过上限时默认折叠；正文不丢，只是视觉收起。 */
export function shouldCollapseOutput(text: string): boolean {
  return text.split('\n').length > OUTPUT_MAX_LINES
}

/** 返回第一个非空字符串参数；用于容忍工具输入里的同义字段。 */
export function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value) return value
  }
  return ''
}

/** 优先取字符串形式的 `output`，否则序列化整个 `rawOutput`；保留全文供折叠展示。 */
export function formatOutput(tool: ToolCallData): string {
  if (tool.rawOutput && Object.keys(tool.rawOutput).length > 0) {
    const output = tool.rawOutput.output
    if (typeof output === 'string') return output
    return JSON.stringify(tool.rawOutput, null, 2)
  }
  return ''
}
