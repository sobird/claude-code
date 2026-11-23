import type { ToolCallData } from '@/lib/session-reducer'

import { firstString, formatOutput } from './format'

export interface WebSource {
  title: string
  url: string
}

export interface WebViewModel {
  /** WebFetch 的地址；WebSearch 为空。 */
  url: string
  query: string
  output: string
  errored: boolean
  /** WebSearch 的 `Links:` 结果（已过滤非法 scheme）；WebFetch 为空数组。 */
  sources: WebSource[]
  /** WebFetch 结构化输出里的 HTTP 状态码；无则 `null`。 */
  httpStatus: number | null
  httpStatusText: string
  /** 抓取体积（字节）；无则 `null`。 */
  bytes: number | null
  /** 抓取+处理耗时（毫秒）；无则 `null`。 */
  durationMs: number | null
}

/** WebSearch 把命中结果塞在一行 `Links: [{title,url}...]` 里。 */
const LINKS_LINE = /^Links: (.+)$/
const REMINDER_LINE = /^REMINDER: You MUST include the sources.*$/

/** 只放行 http(s) 链接，避免把模型给出的任意 scheme 渲染成可点击锚点。 */
export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 卡片头部的抓取体积后缀，如 `1.5 KB`。 */
export function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`
}

/** 卡片头部的耗时后缀，如 `1.2s`。 */
export function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`
}

/** 解析 `Links:` 的 JSON 数组；非法或非数组时返回 `null`，让原文保留。 */
function parseLinks(text: string): WebSource[] | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(value)) return null
  const sources: WebSource[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (!record) continue
    const title = record.title
    const url = record.url
    if (typeof title !== 'string' || typeof url !== 'string') continue
    const safe = safeHttpUrl(url)
    if (!safe) continue
    sources.push({ title, url: safe })
  }
  return sources
}

/** 把 `Links:` 行与结尾的 REMINDER 从正文里摘掉，换成结构化来源。 */
function extractSources(text: string): { sources: WebSource[]; output: string } {
  const sources: WebSource[] = []
  const kept: string[] = []
  for (const line of text.split('\n')) {
    const match = LINKS_LINE.exec(line)
    if (match) {
      const parsed = parseLinks(match[1] ?? '')
      if (parsed) {
        sources.push(...parsed)
        continue
      }
    }
    if (REMINDER_LINE.test(line)) continue
    kept.push(line)
  }
  const output = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { sources, output }
}

/** 提取网页卡片所需的地址或查询词；两者皆无时返回 `null` 以便回退到通用正文。 */
export function webViewModel(tool: ToolCallData): WebViewModel | null {
  const input = tool.rawInput ?? {}
  const url = firstString(input.url)
  const query = firstString(input.query)
  if (!url && !query) return null
  const { sources, output } = extractSources(formatOutput(tool))
  // WebFetch 的结构化输出（stream-json `tool_use_result`）。
  const meta = asRecord(tool.rawOutput?.toolUseResult)
  return {
    url,
    query,
    output,
    errored: tool.status === 'error',
    sources,
    httpStatus: numberOrNull(meta?.code),
    httpStatusText: typeof meta?.codeText === 'string' ? meta.codeText : '',
    bytes: numberOrNull(meta?.bytes),
    durationMs: numberOrNull(meta?.durationMs),
  }
}
