import type { ToolCallData, ToolResultImage } from '@/lib/session-reducer'
import { parseMcpToolName } from '@/lib/tool-summary'

import { formatOutput, toolImages } from './format'

export interface McpInputField {
  key: string
  value: string
}

export interface McpToolViewModel {
  server: string
  tool: string
  /** 透传的 MCP 输入按键序展开；值为字符串或紧凑 JSON。 */
  input: McpInputField[]
  images: ToolResultImage[]
  output: string
  errored: boolean
}

/** 单个参数值的展示上限，避免巨大的 prompt/参数撑爆卡片。 */
const FIELD_MAX_LENGTH = 1200

export function mcpViewModel(tool: ToolCallData): McpToolViewModel | null {
  const name = parseMcpToolName(tool.title)
  if (!name) return null
  return {
    server: name.server,
    tool: name.tool,
    input: inputFields(tool.rawInput),
    images: toolImages(tool),
    output: formatOutput(tool),
    errored: tool.status === 'error',
  }
}

function inputFields(input: Record<string, unknown> | undefined): McpInputField[] {
  if (!input) return []
  return Object.entries(input).map(([key, value]) => ({ key, value: clip(fieldText(value), FIELD_MAX_LENGTH) }))
}

function fieldText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null) return 'null'
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}
