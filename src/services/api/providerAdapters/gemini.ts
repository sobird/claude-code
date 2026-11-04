import {
  asBlocks,
  blockText,
  collectToolUseNames,
  generateMessageId,
  generateToolId,
  systemToText,
  toolResultText,
} from './common.js'
import { stripTrailingSlashes } from './config.js'
import type { AnthropicStreamEvent, JsonObject, ProviderConfig } from './types.js'

export function geminiEndpoint(baseUrl: string, model: string, stream: boolean): string {
  const base = stripTrailingSlashes(baseUrl)
  const cleanModel = model.startsWith('models/') ? model.slice('models/'.length) : model
  const method = stream ? 'streamGenerateContent' : 'generateContent'
  const query = stream ? '?alt=sse' : ''
  return `${base}/models/${encodeURIComponent(cleanModel)}:${method}${query}`
}

function toGeminiTools(tools: unknown): JsonObject[] {
  if (!Array.isArray(tools)) return []
  const out: JsonObject[] = []
  for (const tool of tools as JsonObject[]) {
    if (!tool || typeof tool.name !== 'string' || !tool.input_schema) continue
    out.push({
      name: tool.name,
      description: typeof tool.description === 'string' ? tool.description : '',
      parameters: tool.input_schema,
    })
  }
  return out
}

function toGeminiToolConfig(choice: unknown): JsonObject | null {
  if (!choice || typeof choice !== 'object') return null
  const value = choice as JsonObject
  switch (value.type) {
    case 'auto':
      return { functionCallingConfig: { mode: 'AUTO' } }
    case 'any':
      return { functionCallingConfig: { mode: 'ANY' } }
    case 'none':
      return { functionCallingConfig: { mode: 'NONE' } }
    case 'tool':
      return typeof value.name === 'string'
        ? { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [value.name] } }
        : null
    default:
      return null
  }
}

function blockToGeminiPart(block: JsonObject, toolNames: Map<string, string>): JsonObject | null {
  switch (block.type) {
    case 'text':
      return { text: blockText(block) }
    case 'image': {
      const source = block.source as JsonObject | undefined
      if (source?.type === 'base64' && typeof source.data === 'string') {
        return {
          inlineData: {
            mimeType: typeof source.media_type === 'string' ? source.media_type : 'image/png',
            data: source.data,
          },
        }
      }
      if (source?.type === 'url' && typeof source.url === 'string') {
        return {
          fileData: {
            mimeType: typeof source.media_type === 'string' ? source.media_type : 'image/jpeg',
            fileUri: source.url,
          },
        }
      }
      return null
    }
    case 'tool_use':
      return {
        functionCall: {
          name: typeof block.name === 'string' ? block.name : 'tool',
          args: (block.input ?? {}) as JsonObject,
        },
      }
    case 'tool_result': {
      const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : ''
      return {
        functionResponse: {
          name: toolNames.get(id) || 'tool',
          response: { output: toolResultText(block.content) || '[no output]' },
        },
      }
    }
    case 'document': {
      const source = block.source as JsonObject | undefined
      if (source?.type === 'text' && typeof source.data === 'string') {
        return { text: source.data }
      }
      return null
    }
    default:
      return null
  }
}

function toGeminiContents(message: JsonObject, toolNames: Map<string, string>): JsonObject[] {
  const role = message.role === 'assistant' ? 'model' : 'user'
  const content = message.content
  if (typeof content === 'string') {
    return [{ role, parts: [{ text: content }] }]
  }
  const parts: JsonObject[] = []
  for (const block of asBlocks(content)) {
    const part = blockToGeminiPart(block, toolNames)
    if (part) parts.push(part)
  }
  return parts.length > 0 ? [{ role, parts }] : []
}

/** Gemini requires alternating user/model turns; merge any adjacent same-role turns. */
function mergeGeminiTurns(contents: JsonObject[]): JsonObject[] {
  const merged: JsonObject[] = []
  for (const content of contents) {
    const previous = merged[merged.length - 1]
    if (previous && previous.role === content.role) {
      previous.parts = [...(previous.parts as JsonObject[]), ...(content.parts as JsonObject[])]
    } else {
      merged.push(content)
    }
  }
  return merged
}

export function buildGeminiRequest(body: JsonObject, config: ProviderConfig): JsonObject {
  const rawMessages = Array.isArray(body.messages) ? (body.messages as JsonObject[]) : []
  const toolNames = collectToolUseNames(rawMessages)

  const contents: JsonObject[] = []
  for (const message of rawMessages) {
    contents.push(...toGeminiContents(message, toolNames))
  }

  const request: JsonObject = { contents: mergeGeminiTurns(contents) }
  const system = systemToText(body.system)
  if (system) request.systemInstruction = { parts: [{ text: system }] }

  const tools = toGeminiTools(body.tools)
  if (tools.length > 0) request.tools = [{ functionDeclarations: tools }]
  const toolConfig = toGeminiToolConfig(body.tool_choice)
  if (toolConfig) request.toolConfig = toolConfig

  const generationConfig: JsonObject = {}
  if (typeof body.max_tokens === 'number') generationConfig.maxOutputTokens = body.max_tokens
  if (typeof body.temperature === 'number') generationConfig.temperature = body.temperature
  if (typeof body.top_p === 'number') generationConfig.topP = body.top_p
  if (Object.keys(generationConfig).length > 0) request.generationConfig = generationConfig

  return request
}

function mapGeminiFinishReason(reason: unknown, hasToolUse: boolean): string {
  if (hasToolUse) return 'tool_use'
  switch (reason) {
    case 'MAX_TOKENS':
      return 'max_tokens'
    case 'MALFORMED_FUNCTION_CALL':
      return 'tool_use'
    default:
      return 'end_turn'
  }
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function usageFromGemini(usage: JsonObject): JsonObject {
  return {
    input_tokens: numberOrZero(usage.promptTokenCount),
    output_tokens: numberOrZero(usage.candidatesTokenCount),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
}

function partsFromCandidate(candidate: JsonObject): JsonObject[] {
  const content = (candidate.content ?? {}) as JsonObject
  return Array.isArray(content.parts) ? (content.parts as JsonObject[]) : []
}

export function geminiJsonToAnthropic(json: JsonObject, requestedModel: string): JsonObject {
  const candidates = Array.isArray(json.candidates) ? (json.candidates as JsonObject[]) : []
  const candidate = candidates[0] ?? {}
  const content: JsonObject[] = []
  let hasToolUse = false

  for (const part of partsFromCandidate(candidate)) {
    if (part.thought === true) continue
    if (typeof part.text === 'string' && part.text.length > 0) {
      const last = content[content.length - 1]
      if (last?.type === 'text') {
        last.text = `${last.text}${part.text}`
      } else {
        content.push({ type: 'text', text: part.text })
      }
    } else if (part.functionCall && typeof part.functionCall === 'object') {
      const call = part.functionCall as JsonObject
      hasToolUse = true
      content.push({
        type: 'tool_use',
        id: generateToolId(),
        name: typeof call.name === 'string' ? call.name : 'tool',
        input: (call.args ?? {}) as JsonObject,
      })
    }
  }

  const usage = (json.usageMetadata ?? {}) as JsonObject
  return {
    id: generateMessageId(),
    type: 'message',
    role: 'assistant',
    model: requestedModel,
    content: content.length > 0 ? content : [{ type: 'text', text: '' }],
    stop_reason: mapGeminiFinishReason(candidate.finishReason, hasToolUse),
    stop_sequence: null,
    usage: usageFromGemini(usage),
  }
}

export async function* geminiStreamToAnthropic(
  events: AsyncIterable<JsonObject>,
  requestedModel: string,
): AsyncGenerator<AnthropicStreamEvent> {
  const messageId = generateMessageId()
  let started = false
  let nextBlockIndex = 0
  let activeKind: 'text' | 'tool' | null = null
  let activeBlockIndex = -1
  let hasToolUse = false
  let finishReason: unknown = undefined
  let inputTokens = 0
  let outputTokens = 0

  const startMessage = (): AnthropicStreamEvent => ({
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      model: requestedModel,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  })

  for await (const chunk of events) {
    if (!started) {
      started = true
      yield startMessage()
    }

    const usage = (chunk.usageMetadata ?? {}) as JsonObject
    if (typeof usage.promptTokenCount === 'number') inputTokens = usage.promptTokenCount
    if (typeof usage.candidatesTokenCount === 'number') outputTokens = usage.candidatesTokenCount

    const candidates = Array.isArray(chunk.candidates) ? (chunk.candidates as JsonObject[]) : []
    for (const candidate of candidates) {
      if (typeof candidate.finishReason === 'string') finishReason = candidate.finishReason
      for (const part of partsFromCandidate(candidate)) {
        if (part.thought === true) continue

        if (typeof part.text === 'string' && part.text.length > 0) {
          if (activeKind !== 'text') {
            if (activeKind !== null) {
              yield { type: 'content_block_stop', index: activeBlockIndex }
            }
            activeKind = 'text'
            activeBlockIndex = nextBlockIndex++
            yield {
              type: 'content_block_start',
              index: activeBlockIndex,
              content_block: { type: 'text', text: '' },
            }
          }
          yield {
            type: 'content_block_delta',
            index: activeBlockIndex,
            delta: { type: 'text_delta', text: part.text },
          }
        } else if (part.functionCall && typeof part.functionCall === 'object') {
          const call = part.functionCall as JsonObject
          if (activeKind !== null) {
            yield { type: 'content_block_stop', index: activeBlockIndex }
          }
          activeKind = 'tool'
          activeBlockIndex = nextBlockIndex++
          hasToolUse = true
          yield {
            type: 'content_block_start',
            index: activeBlockIndex,
            content_block: {
              type: 'tool_use',
              id: generateToolId(),
              name: typeof call.name === 'string' ? call.name : 'tool',
              input: {},
            },
          }
          yield {
            type: 'content_block_delta',
            index: activeBlockIndex,
            delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.args ?? {}) },
          }
        }
      }
    }
  }

  if (!started) {
    yield startMessage()
  }
  if (activeKind !== null) {
    yield { type: 'content_block_stop', index: activeBlockIndex }
  }
  yield {
    type: 'message_delta',
    delta: {
      stop_reason: mapGeminiFinishReason(finishReason, hasToolUse),
      stop_sequence: null,
    },
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  }
  yield { type: 'message_stop' }
}
