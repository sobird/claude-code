import type { ToolCallData } from '@/lib/session-reducer'

/** 与原先通用正文一致的输出截断长度。 */
export const OUTPUT_LIMIT = 2000

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

/** 返回第一个非空字符串参数；用于容忍工具输入里的同义字段。 */
export function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value) return value
  }
  return ''
}

/** 优先取字符串形式的 `output`，否则序列化整个 `rawOutput`。 */
export function formatOutput(tool: ToolCallData): string {
  if (tool.rawOutput && Object.keys(tool.rawOutput).length > 0) {
    const output = tool.rawOutput.output
    if (typeof output === 'string') return truncate(output, OUTPUT_LIMIT)
    return truncate(JSON.stringify(tool.rawOutput, null, 2), OUTPUT_LIMIT)
  }
  return ''
}
