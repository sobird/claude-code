import type { JsonObject } from './types.js'

export function asBlocks(value: unknown): JsonObject[] {
  if (typeof value === 'string') {
    return [{ type: 'text', text: value }]
  }
  return Array.isArray(value) ? (value as JsonObject[]) : []
}

export function blockText(block: JsonObject): string {
  if (block.type === 'text' && typeof block.text === 'string') {
    return block.text
  }
  return ''
}

export function systemToText(system: unknown): string {
  if (typeof system === 'string') return system
  if (!Array.isArray(system)) return ''
  return (system as JsonObject[]).map(blockText).filter(Boolean).join('\n')
}

/** Maps Anthropic tool_use ids to names so tool_result blocks can be labelled. */
export function collectToolUseNames(messages: JsonObject[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const message of messages) {
    for (const block of asBlocks(message.content)) {
      if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        names.set(block.id, block.name)
      }
    }
  }
  return names
}

export function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content as JsonObject[]) {
    if (item.type === 'text' && typeof item.text === 'string') {
      parts.push(item.text)
    } else if (item.type === 'image') {
      parts.push('[image]')
    }
  }
  return parts.join('\n')
}

export function imageToDataUrl(block: JsonObject): string | null {
  const source = block.source as JsonObject | undefined
  if (!source) return null
  if (source.type === 'base64' && typeof source.data === 'string') {
    const mediaType = typeof source.media_type === 'string' ? source.media_type : 'image/png'
    return `data:${mediaType};base64,${source.data}`
  }
  if (source.type === 'url' && typeof source.url === 'string') {
    return source.url
  }
  return null
}

export function generateMessageId(prefix = 'msg'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export function generateToolId(): string {
  return `toolu_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export function parseToolInput(raw: string | undefined): JsonObject {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as JsonObject) : {}
  } catch {
    return {}
  }
}

/** Anthropic token estimates for providers without a count_tokens endpoint. */
export function estimateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return Math.max(1, Math.ceil(text.length / 4))
}
