import {
  asBlocks,
  blockText,
  collectToolUseNames,
  generateMessageId,
  generateToolId,
  imageToDataUrl,
  parseToolInput,
  systemToText,
  toolResultText,
} from './common.js'
import { resolveProviderModel, stripTrailingSlashes } from './config.js'
import type { AnthropicStreamEvent, JsonObject, ProviderConfig } from './types.js'

export function openAIChatUrl(baseUrl: string): string {
  const base = stripTrailingSlashes(baseUrl)
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

function toOpenAITools(tools: unknown): JsonObject[] {
  if (!Array.isArray(tools)) return []
  const out: JsonObject[] = []
  for (const tool of tools as JsonObject[]) {
    if (!tool || typeof tool.name !== 'string' || !tool.input_schema) continue
    out.push({
      type: 'function',
      function: {
        name: tool.name,
        description: typeof tool.description === 'string' ? tool.description : '',
        parameters: tool.input_schema,
      },
    })
  }
  return out
}

function toOpenAIToolChoice(choice: unknown): unknown {
  if (!choice || typeof choice !== 'object') return undefined
  const value = choice as JsonObject
  switch (value.type) {
    case 'auto':
      return 'auto'
    case 'any':
      return 'required'
    case 'none':
      return 'none'
    case 'tool':
      return typeof value.name === 'string' ? { type: 'function', function: { name: value.name } } : undefined
    default:
      return undefined
  }
}

function userBlockToOpenAIPart(block: JsonObject): JsonObject | null {
  if (block.type === 'text') {
    return { type: 'text', text: blockText(block) }
  }
  if (block.type === 'image') {
    const url = imageToDataUrl(block)
    return url ? { type: 'image_url', image_url: { url } } : null
  }
  if (block.type === 'document') {
    const source = block.source as JsonObject | undefined
    if (source?.type === 'text' && typeof source.data === 'string') {
      return { type: 'text', text: source.data }
    }
    return null
  }
  return null
}

function toOpenAIMessages(message: JsonObject, toolNames: Map<string, string>): JsonObject[] {
  const role = message.role === 'assistant' ? 'assistant' : 'user'
  const content = message.content
  if (typeof content === 'string') {
    return [{ role, content }]
  }
  const blocks = asBlocks(content)

  if (role === 'assistant') {
    let text = ''
    const toolCalls: JsonObject[] = []
    for (const block of blocks) {
      if (block.type === 'text') {
        text += blockText(block)
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: typeof block.id === 'string' ? block.id : generateToolId(),
          type: 'function',
          function: {
            name: typeof block.name === 'string' ? block.name : toolNames.get(String(block.id)) || 'tool',
            arguments: JSON.stringify(block.input ?? {}),
          },
        })
      }
    }
    if (!text && toolCalls.length === 0) return []
    return [
      {
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      },
    ]
  }

  const out: JsonObject[] = []
  let parts: JsonObject[] = []
  const flushParts = () => {
    if (parts.length === 0) return
    const onlyText = parts.length === 1 && parts[0].type === 'text'
    out.push({ role: 'user', content: onlyText ? parts[0].text : parts })
    parts = []
  }

  for (const block of blocks) {
    if (block.type === 'tool_result') {
      flushParts()
      out.push({
        role: 'tool',
        tool_call_id: typeof block.tool_use_id === 'string' ? block.tool_use_id : '',
        content: toolResultText(block.content) || '[no output]',
      })
      continue
    }
    const part = userBlockToOpenAIPart(block)
    if (part) parts.push(part)
  }
  flushParts()
  return out
}

export function buildOpenAIRequest(body: JsonObject, config: ProviderConfig): JsonObject {
  const rawMessages = Array.isArray(body.messages) ? (body.messages as JsonObject[]) : []
  const toolNames = collectToolUseNames(rawMessages)

  const messages: JsonObject[] = []
  const system = systemToText(body.system)
  if (system) messages.push({ role: 'system', content: system })
  for (const message of rawMessages) {
    messages.push(...toOpenAIMessages(message, toolNames))
  }

  const request: JsonObject = {
    model: resolveProviderModel(typeof body.model === 'string' ? body.model : '', config),
    messages,
  }
  if (body.stream === true) {
    request.stream = true
    request.stream_options = { include_usage: true }
  }
  if (typeof body.max_tokens === 'number') request.max_tokens = body.max_tokens
  if (typeof body.temperature === 'number') request.temperature = body.temperature
  if (typeof body.top_p === 'number') request.top_p = body.top_p
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length > 0) {
    request.stop = body.stop_sequences
  }
  const tools = toOpenAITools(body.tools)
  if (tools.length > 0) request.tools = tools
  const toolChoice = toOpenAIToolChoice(body.tool_choice)
  if (toolChoice !== undefined) request.tool_choice = toolChoice
  return request
}

function mapFinishReason(reason: unknown): string {
  switch (reason) {
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    case 'content_filter':
      return 'end_turn'
    default:
      return 'end_turn'
  }
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function openAIJsonToAnthropic(json: JsonObject, requestedModel: string): JsonObject {
  const choices = Array.isArray(json.choices) ? (json.choices as JsonObject[]) : []
  const choice = choices[0] ?? {}
  const message = (choice.message ?? {}) as JsonObject
  const content: JsonObject[] = []

  if (typeof message.content === 'string' && message.content.length > 0) {
    content.push({ type: 'text', text: message.content })
  }
  const toolCalls = Array.isArray(message.tool_calls) ? (message.tool_calls as JsonObject[]) : []
  for (const call of toolCalls) {
    const fn = (call.function ?? {}) as JsonObject
    content.push({
      type: 'tool_use',
      id: typeof call.id === 'string' && call.id ? call.id : generateToolId(),
      name: typeof fn.name === 'string' ? fn.name : 'tool',
      input: parseToolInput(typeof fn.arguments === 'string' ? fn.arguments : undefined),
    })
  }

  const usage = (json.usage ?? {}) as JsonObject
  return {
    id: typeof json.id === 'string' ? json.id : generateMessageId(),
    type: 'message',
    role: 'assistant',
    model: typeof json.model === 'string' && json.model ? json.model : requestedModel,
    content: content.length > 0 ? content : [{ type: 'text', text: '' }],
    stop_reason: toolCalls.length > 0 ? 'tool_use' : mapFinishReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: numberOrZero(usage.prompt_tokens),
      output_tokens: numberOrZero(usage.completion_tokens),
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  }
}

export async function* openAIStreamToAnthropic(
  events: AsyncIterable<JsonObject>,
  requestedModel: string,
): AsyncGenerator<AnthropicStreamEvent> {
  let started = false
  let messageId = generateMessageId()
  let model = requestedModel
  let nextBlockIndex = 0
  let activeKind: 'text' | 'tool' | null = null
  let activeBlockIndex = -1
  const toolBlockByOpenAIIndex = new Map<number, number>()
  let stopReason: string | null = null
  let inputTokens = 0
  let outputTokens = 0

  for await (const chunk of events) {
    if (!started) {
      started = true
      if (typeof chunk.id === 'string' && chunk.id) messageId = chunk.id
      if (typeof chunk.model === 'string' && chunk.model) model = chunk.model
      yield {
        type: 'message_start',
        message: {
          id: messageId,
          type: 'message',
          role: 'assistant',
          model,
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
      }
    }

    const usage = (chunk.usage ?? {}) as JsonObject
    if (typeof usage.prompt_tokens === 'number') inputTokens = usage.prompt_tokens
    if (typeof usage.completion_tokens === 'number') outputTokens = usage.completion_tokens

    const choices = Array.isArray(chunk.choices) ? (chunk.choices as JsonObject[]) : []
    for (const choice of choices) {
      const delta = (choice.delta ?? {}) as JsonObject

      if (typeof delta.content === 'string' && delta.content.length > 0) {
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
          delta: { type: 'text_delta', text: delta.content },
        }
      }

      const toolCalls = Array.isArray(delta.tool_calls) ? (delta.tool_calls as JsonObject[]) : []
      for (const call of toolCalls) {
        const openaiIndex = typeof call.index === 'number' ? call.index : 0
        let index = toolBlockByOpenAIIndex.get(openaiIndex)
        const fn = (call.function ?? {}) as JsonObject
        if (index === undefined) {
          if (activeKind !== null) {
            yield { type: 'content_block_stop', index: activeBlockIndex }
          }
          index = nextBlockIndex++
          toolBlockByOpenAIIndex.set(openaiIndex, index)
          activeKind = 'tool'
          activeBlockIndex = index
          yield {
            type: 'content_block_start',
            index,
            content_block: {
              type: 'tool_use',
              id: typeof call.id === 'string' && call.id ? call.id : generateToolId(),
              name: typeof fn.name === 'string' ? fn.name : 'tool',
              input: {},
            },
          }
        } else if (index !== activeBlockIndex) {
          // Anthropic content blocks are sequential and cannot be reopened, so
          // arguments for an older interleaved call are dropped. Standard
          // OpenAI servers stream one tool call at a time.
          continue
        }
        if (typeof fn.arguments === 'string' && fn.arguments.length > 0) {
          yield {
            type: 'content_block_delta',
            index,
            delta: { type: 'input_json_delta', partial_json: fn.arguments },
          }
        }
      }

      if (typeof choice.finish_reason === 'string') {
        stopReason = mapFinishReason(choice.finish_reason)
      }
    }
  }

  if (!started) {
    yield {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model,
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
    }
  }
  if (activeKind !== null) {
    yield { type: 'content_block_stop', index: activeBlockIndex }
  }
  yield {
    type: 'message_delta',
    delta: {
      stop_reason:
        toolBlockByOpenAIIndex.size > 0 && stopReason !== 'max_tokens' ? 'tool_use' : (stopReason ?? 'end_turn'),
      stop_sequence: null,
    },
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  }
  yield { type: 'message_stop' }
}
