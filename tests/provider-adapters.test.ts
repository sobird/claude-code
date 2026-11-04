import { afterEach, describe, expect, test } from 'bun:test'

import { buildPlatformEnv, validatePlatformValues } from '../src/components/platformConfig'
import { getProviderConfig, resolveProviderModel } from '../src/services/api/providerAdapters/config'
import {
  buildGeminiRequest,
  geminiEndpoint,
  geminiJsonToAnthropic,
  geminiStreamToAnthropic,
} from '../src/services/api/providerAdapters/gemini'
import { createProviderFetch } from '../src/services/api/providerAdapters/index'
import {
  buildOpenAIRequest,
  openAIChatUrl,
  openAIJsonToAnthropic,
  openAIStreamToAnthropic,
} from '../src/services/api/providerAdapters/openai'
import { parseSSEEvents } from '../src/services/api/providerAdapters/sse'
import type { JsonObject, ProviderConfig } from '../src/services/api/providerAdapters/types'

const openaiConfig: ProviderConfig = {
  kind: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  models: { haiku: 'gpt-4o-mini', sonnet: 'gpt-4o', opus: 'o3' },
}

const geminiConfig: ProviderConfig = {
  kind: 'gemini',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  apiKey: 'gm-test',
  models: { haiku: 'gemini-2.5-flash', sonnet: 'gemini-2.5-pro', opus: 'gemini-2.5-pro' },
}

function sseBody(chunks: JsonObject[]): ReadableStream<Uint8Array> {
  const text = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')
  return new Response(text).body as ReadableStream<Uint8Array>
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const event of events) out.push(event)
  return out
}

function textDeltas(events: JsonObject[]): string {
  return events
    .filter((event) => event.type === 'content_block_delta')
    .map((event) => {
      const delta = event.delta as JsonObject
      return delta.type === 'text_delta' ? String(delta.text) : ''
    })
    .join('')
}

function toolInputDeltas(events: JsonObject[]): string {
  return events
    .filter((event) => event.type === 'content_block_delta')
    .map((event) => {
      const delta = event.delta as JsonObject
      return delta.type === 'input_json_delta' ? String(delta.partial_json) : ''
    })
    .join('')
}

describe('provider config', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  test('returns null for the default Anthropic provider', () => {
    delete process.env.CLAUDE_CODE_API_PROVIDER
    expect(getProviderConfig()).toBeNull()
  })

  test('reads openai env and falls back to the default base URL', () => {
    process.env.CLAUDE_CODE_API_PROVIDER = 'openai'
    delete process.env.OPENAI_BASE_URL
    process.env.OPENAI_API_KEY = 'sk-test'
    process.env.OPENAI_DEFAULT_SONNET_MODEL = 'gpt-4o'
    const config = getProviderConfig()
    expect(config?.kind).toBe('openai')
    expect(config?.baseUrl).toBe('https://api.openai.com/v1')
    expect(config?.apiKey).toBe('sk-test')
    expect(config?.models.sonnet).toBe('gpt-4o')
  })

  test('maps requested models by tier and falls back to provider defaults', () => {
    expect(resolveProviderModel('claude-3-5-haiku-20241022', openaiConfig)).toBe('gpt-4o-mini')
    expect(resolveProviderModel('claude-opus-4-6', openaiConfig)).toBe('o3')
    expect(resolveProviderModel('claude-sonnet-4-5', openaiConfig)).toBe('gpt-4o')
    // Unknown names default to the sonnet tier; an unset tier falls back to the
    // provider's built-in default instead of forwarding a Claude model id.
    expect(resolveProviderModel('my-custom-model', geminiConfig)).toBe('gemini-2.5-pro')
    expect(
      resolveProviderModel('my-custom-model', {
        ...geminiConfig,
        models: { ...geminiConfig.models, sonnet: '' },
      }),
    ).toBe('gemini-2.5-pro')
    expect(
      resolveProviderModel('claude-haiku-4-5', {
        ...openaiConfig,
        models: { haiku: '', sonnet: '', opus: '' },
      }),
    ).toBe('gpt-4o-mini')
  })

  test('allows OPENAI_MODEL / GEMINI_MODEL to override every tier', () => {
    process.env.OPENAI_MODEL = 'gpt-4.1'
    process.env.GEMINI_MODEL = 'gemini-2.5-pro-latest'
    expect(resolveProviderModel('claude-haiku-4-5', openaiConfig)).toBe('gpt-4.1')
    expect(resolveProviderModel('claude-opus-4-6', geminiConfig)).toBe('gemini-2.5-pro-latest')
  })
})

describe('OpenAI adapter', () => {
  test('translates system, images, tools and tool results', () => {
    const request = buildOpenAIRequest(
      {
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        temperature: 0.2,
        system: [{ type: 'text', text: 'be brief' }],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'look' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
            ],
          },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'sure' },
              { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { path: 'a' } },
            ],
          },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'done' }] },
        ],
        tools: [{ name: 'Read', description: 'read', input_schema: { type: 'object', properties: {} } }],
        tool_choice: { type: 'auto' },
        thinking: { type: 'enabled' },
      },
      openaiConfig,
    )

    expect(request.model).toBe('gpt-4o')
    expect(request.max_tokens).toBe(1024)
    expect(request.messages).toEqual([
      { role: 'system', content: 'be brief' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
        ],
      },
      {
        role: 'assistant',
        content: 'sure',
        tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'Read', arguments: '{"path":"a"}' } }],
      },
      { role: 'tool', tool_call_id: 'toolu_1', content: 'done' },
    ])
    expect(request.tools).toEqual([
      {
        type: 'function',
        function: { name: 'Read', description: 'read', parameters: { type: 'object', properties: {} } },
      },
    ])
    expect(request.tool_choice).toBe('auto')
    expect(request.thinking).toBeUndefined()
  })

  test('translates non-streaming completions into an Anthropic message', () => {
    const message = openAIJsonToAnthropic(
      {
        id: 'chatcmpl-1',
        model: 'gpt-4o',
        choices: [
          {
            message: {
              content: 'hi',
              tool_calls: [{ id: 'call_1', function: { name: 'Read', arguments: '{"path":"a"}' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      },
      'claude-sonnet-4-5',
    )

    expect(message.content).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: 'call_1', name: 'Read', input: { path: 'a' } },
    ])
    expect(message.stop_reason).toBe('tool_use')
    expect(message.usage).toEqual({
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    })
  })

  test('translates streamed text and tool calls into Anthropic SSE events', async () => {
    const events = await collect(
      openAIStreamToAnthropic(
        parseSSEEvents(
          sseBody([
            { id: 'chatcmpl-2', model: 'gpt-4o', choices: [{ delta: { content: 'Hello' } }] },
            { choices: [{ delta: { content: ' world' } }] },
            {
              choices: [
                {
                  delta: {
                    tool_calls: [{ index: 0, id: 'call_1', function: { name: 'Read', arguments: '{"path":' } }],
                  },
                },
              ],
            },
            {
              choices: [
                { delta: { tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] }, finish_reason: 'tool_calls' },
              ],
            },
            { choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } },
          ]),
        ),
        'claude-sonnet-4-5',
      ),
    )

    expect(events[0].type).toBe('message_start')
    expect(textDeltas(events)).toBe('Hello world')
    expect(toolInputDeltas(events)).toBe('{"path":"a"}')
    expect(events.filter((event) => event.type === 'content_block_start').length).toBe(2)
    expect(events.filter((event) => event.type === 'content_block_stop').length).toBe(2)
    const terminal: JsonObject = events.find((event) => event.type === 'message_delta') ?? {}
    expect((terminal.delta as JsonObject).stop_reason).toBe('tool_use')
    expect((terminal.usage as JsonObject).output_tokens).toBe(7)
    expect(events[events.length - 1].type).toBe('message_stop')
  })

  test('builds the chat completions URL without duplicating the suffix', () => {
    expect(openAIChatUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/chat/completions')
    expect(openAIChatUrl('https://x.test/chat/completions')).toBe('https://x.test/chat/completions')
  })
})

describe('Gemini adapter', () => {
  test('translates messages, images and tool calls/results', () => {
    const request = buildGeminiRequest(
      {
        model: 'claude-sonnet-4-5',
        max_tokens: 2048,
        temperature: 0.1,
        system: 'be brief',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'look' },
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBB' } },
            ],
          },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'toolu_9', name: 'Read', input: { path: 'b' } }],
          },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_9', content: 'ok' }] },
        ],
        tools: [{ name: 'Read', description: 'read', input_schema: { type: 'object', properties: {} } }],
        tool_choice: { type: 'any' },
      },
      geminiConfig,
    )

    expect(request.systemInstruction).toEqual({ parts: [{ text: 'be brief' }] })
    expect(request.contents).toEqual([
      {
        role: 'user',
        parts: [{ text: 'look' }, { inlineData: { mimeType: 'image/jpeg', data: 'BBB' } }],
      },
      { role: 'model', parts: [{ functionCall: { name: 'Read', args: { path: 'b' } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'Read', response: { output: 'ok' } } }] },
    ])
    expect(request.tools).toEqual([
      { functionDeclarations: [{ name: 'Read', description: 'read', parameters: { type: 'object', properties: {} } }] },
    ])
    expect(request.toolConfig).toEqual({ functionCallingConfig: { mode: 'ANY' } })
    expect(request.generationConfig).toEqual({ maxOutputTokens: 2048, temperature: 0.1 })
  })

  test('translates non-streaming responses', () => {
    const message = geminiJsonToAnthropic(
      {
        candidates: [
          {
            content: { parts: [{ text: 'hi' }, { functionCall: { name: 'Read', args: { path: 'a' } } }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
      },
      'gemini-2.5-pro',
    )

    expect(message.content).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: expect.any(String), name: 'Read', input: { path: 'a' } },
    ])
    expect(message.stop_reason).toBe('tool_use')
    expect(message.usage).toEqual({
      input_tokens: 3,
      output_tokens: 4,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    })
  })

  test('translates streamed text and function calls', async () => {
    const events = await collect(
      geminiStreamToAnthropic(
        parseSSEEvents(
          sseBody([
            { candidates: [{ content: { parts: [{ text: 'Hel' }] } }] },
            {
              candidates: [{ content: { parts: [{ text: 'lo' }] }, finishReason: 'STOP' }],
              usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 },
            },
          ]),
        ),
        'gemini-2.5-pro',
      ),
    )

    expect(events[0].type).toBe('message_start')
    expect(textDeltas(events)).toBe('Hello')
    const terminal: JsonObject = events.find((event) => event.type === 'message_delta') ?? {}
    expect((terminal.delta as JsonObject).stop_reason).toBe('end_turn')
    expect((terminal.usage as JsonObject).output_tokens).toBe(3)
    expect(events[events.length - 1].type).toBe('message_stop')
  })

  test('builds streamGenerateContent endpoints', () => {
    expect(geminiEndpoint('https://generativelanguage.googleapis.com/v1beta', 'models/gemini-2.5-pro', true)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse',
    )
    expect(geminiEndpoint('https://x.test/v1beta/', 'gemini-2.5-flash', false)).toBe(
      'https://x.test/v1beta/models/gemini-2.5-flash:generateContent',
    )
  })
})

describe('provider fetch', () => {
  test('rewrites /v1/messages to the provider and returns an Anthropic message', async () => {
    let captured: { url: string; body: JsonObject; headers: Headers } | undefined
    const innerFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      captured = {
        url: String(input),
        body: JSON.parse(String(init?.body)) as JsonObject,
        headers: new Headers(init?.headers),
      }
      return Response.json({
        id: 'chatcmpl-3',
        model: 'gpt-4o',
        choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      })
    }
    const providerFetch = createProviderFetch(openaiConfig, innerFetch)

    const response = await providerFetch('https://claude-code-provider.invalid/v1/messages?beta=true', {
      method: 'POST',
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] }),
    })
    const message = (await response.json()) as JsonObject

    expect(captured?.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(captured?.headers.get('authorization')).toBe('Bearer sk-test')
    expect(captured?.body.model).toBe('gpt-4o-mini')
    expect(message.type).toBe('message')
    expect(message.content).toEqual([{ type: 'text', text: 'hi' }])
  })

  test('estimates count_tokens without calling the provider', async () => {
    let called = false
    const providerFetch = createProviderFetch(openaiConfig, async () => {
      called = true
      return Response.json({})
    })
    const response = await providerFetch('https://claude-code-provider.invalid/v1/messages/count_tokens', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello world' }] }),
    })
    const json = (await response.json()) as JsonObject
    expect(called).toBe(false)
    expect(typeof json.input_tokens).toBe('number')
    expect(json.input_tokens as number).toBeGreaterThan(0)
  })

  test('maps provider errors to Anthropic error responses', async () => {
    const providerFetch = createProviderFetch(geminiConfig, async () =>
      Response.json({ error: { message: 'bad key' } }, { status: 401 }),
    )
    const response = await providerFetch('https://claude-code-provider.invalid/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [] }),
    })
    const json = (await response.json()) as JsonObject
    expect(response.status).toBe(401)
    expect(json.type).toBe('error')
    expect((json.error as JsonObject).type).toBe('authentication_error')
    expect((json.error as JsonObject).message).toBe('bad key')
  })

  test('redacts the configured API key from provider error messages', async () => {
    const verboseConfig: ProviderConfig = { ...openaiConfig, apiKey: 'sk-test-1234567890' }
    const providerFetch = createProviderFetch(verboseConfig, async () =>
      Response.json({ error: { message: 'Incorrect API key provided: sk-test-1234567890' } }, { status: 401 }),
    )
    const response = await providerFetch('https://claude-code-provider.invalid/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [] }),
    })
    const json = (await response.json()) as JsonObject
    const message = String((json.error as JsonObject).message)
    expect(message).not.toContain('sk-test-1234567890')
    expect(message).toBe('Incorrect API key provided: sk-...890')
  })
})

describe('platform setup config', () => {
  const values = { baseUrl: 'https://api.example.com', apiKey: 'k', haikuModel: 'h', sonnetModel: 's', opusModel: '' }

  test('builds provider env vars and skips empty fields', () => {
    expect(buildPlatformEnv('anthropic', values)).toEqual({
      CLAUDE_CODE_API_PROVIDER: 'anthropic',
      ANTHROPIC_BASE_URL: 'https://api.example.com',
      ANTHROPIC_AUTH_TOKEN: 'k',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'h',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 's',
    })
    expect(buildPlatformEnv('openai', values)).toMatchObject({
      CLAUDE_CODE_API_PROVIDER: 'openai',
      OPENAI_BASE_URL: 'https://api.example.com',
      OPENAI_API_KEY: 'k',
    })
    expect(buildPlatformEnv('gemini', values)).toMatchObject({
      CLAUDE_CODE_API_PROVIDER: 'gemini',
      GEMINI_BASE_URL: 'https://api.example.com',
      GEMINI_API_KEY: 'k',
    })
  })

  test('validates required and malformed base URLs', () => {
    const empty = { ...values, baseUrl: '' }
    expect(validatePlatformValues('anthropic', empty)).toContain('Base URL is required')
    expect(validatePlatformValues('openai', empty)).toBeNull()
    expect(validatePlatformValues('gemini', { ...values, baseUrl: 'not-a-url' })).toContain('Invalid base URL')
    expect(validatePlatformValues('anthropic', values)).toBeNull()
  })
})
