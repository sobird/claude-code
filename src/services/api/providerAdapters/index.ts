import { redactSecretFromText } from '../../../utils/secretMask.js'
import { estimateTokens } from './common.js'
import { resolveProviderModel } from './config.js'
import { geminiEndpoint, geminiJsonToAnthropic, geminiStreamToAnthropic, buildGeminiRequest } from './gemini.js'
import { buildOpenAIRequest, openAIChatUrl, openAIJsonToAnthropic, openAIStreamToAnthropic } from './openai.js'
import { anthropicSSEResponse, parseSSEEvents } from './sse.js'
import type { AnthropicStreamEvent, JsonObject, ProviderConfig } from './types.js'

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

async function readJsonBody(init: RequestInit | undefined): Promise<JsonObject> {
  const body = init?.body
  if (body === null || body === undefined) return {}
  if (typeof body === 'string') return JSON.parse(body) as JsonObject
  if (body instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(body)) as JsonObject
  if (body instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(body)) as JsonObject
  throw new Error('Unsupported request body type for provider translation')
}

function errorTypeForStatus(status: number): string {
  if (status === 401 || status === 403) return 'authentication_error'
  if (status === 404) return 'not_found_error'
  if (status === 429) return 'rate_limit_error'
  if (status >= 400 && status < 500) return 'invalid_request_error'
  if (status >= 500) return 'api_error'
  return 'invalid_request_error'
}

export function anthropicErrorResponse(status: number, message: string, type = errorTypeForStatus(status)): Response {
  return new Response(JSON.stringify({ type: 'error', error: { type, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function providerErrorMessage(response: Response, config: ProviderConfig): Promise<string> {
  let message: string
  try {
    const text = await response.text()
    try {
      const json = JSON.parse(text) as JsonObject
      const error = json.error as JsonObject | undefined
      message =
        typeof error?.message === 'string' ? error.message : text || response.statusText || `HTTP ${response.status}`
    } catch {
      // Fall through to the raw body.
      message = text || response.statusText || `HTTP ${response.status}`
    }
  } catch {
    message = response.statusText || `HTTP ${response.status}`
  }
  // Providers sometimes echo the submitted key in an auth error; never surface
  // it verbatim to the user.
  return redactSecretFromText(message, config.apiKey)
}

function providerHeaders(config: ProviderConfig): Record<string, string> {
  if (config.kind === 'openai') {
    return {
      'content-type': 'application/json',
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    }
  }
  return {
    'content-type': 'application/json',
    ...(config.apiKey ? { 'x-goog-api-key': config.apiKey } : {}),
  }
}

function responseRequestId(response: Response): string | undefined {
  return response.headers.get('request-id') ?? response.headers.get('x-request-id') ?? undefined
}

function estimateInputTokens(body: JsonObject): number {
  return estimateTokens([body.system ?? '', body.messages ?? [], body.tools ?? []])
}

function translateStream(
  config: ProviderConfig,
  response: Response,
  model: string,
  signal: AbortSignal | undefined,
): Response {
  if (!response.body) {
    return anthropicErrorResponse(502, `The ${config.kind} provider returned an empty stream`)
  }
  const events = parseSSEEvents(response.body)
  const translated =
    config.kind === 'openai' ? openAIStreamToAnthropic(events, model) : geminiStreamToAnthropic(events, model)
  return anthropicSSEResponse(translated as AsyncIterable<AnthropicStreamEvent>, {
    signal,
    requestId: responseRequestId(response),
  })
}

export type ProviderFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

async function handleMessages(
  config: ProviderConfig,
  init: RequestInit | undefined,
  innerFetch: ProviderFetch,
): Promise<Response> {
  const body = await readJsonBody(init)
  const requestedModel = typeof body.model === 'string' ? body.model : ''
  const model = resolveProviderModel(requestedModel, config)
  const stream = body.stream === true

  const providerRequest = config.kind === 'openai' ? buildOpenAIRequest(body, config) : buildGeminiRequest(body, config)
  const url = config.kind === 'openai' ? openAIChatUrl(config.baseUrl) : geminiEndpoint(config.baseUrl, model, stream)

  const response = await innerFetch(url, {
    method: 'POST',
    headers: providerHeaders(config),
    body: JSON.stringify(providerRequest),
    signal: init?.signal ?? undefined,
  })

  if (!response.ok) {
    return anthropicErrorResponse(response.status, await providerErrorMessage(response, config))
  }

  if (stream) {
    return translateStream(config, response, model, init?.signal ?? undefined)
  }

  const json = (await response.json()) as JsonObject
  const message = config.kind === 'openai' ? openAIJsonToAnthropic(json, model) : geminiJsonToAnthropic(json, model)
  const requestId = responseRequestId(response)
  return new Response(JSON.stringify(message), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      ...(requestId ? { 'request-id': requestId } : {}),
    },
  })
}

/**
 * Builds the fetch used by the Anthropic SDK when a translated provider is
 * configured. The SDK still speaks the Anthropic Messages API; this function
 * rewrites each request to the provider's native protocol and translates the
 * response (including SSE streams) back.
 */
export function createProviderFetch(config: ProviderConfig, innerFetch: ProviderFetch): ProviderFetch {
  return async (input, init) => {
    let pathname: string
    try {
      pathname = new URL(requestUrl(input)).pathname
    } catch {
      return anthropicErrorResponse(400, 'Invalid request URL for provider translation')
    }

    if (pathname.endsWith('/v1/messages/count_tokens')) {
      const body = await readJsonBody(init)
      return new Response(JSON.stringify({ input_tokens: estimateInputTokens(body) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (pathname.endsWith('/v1/messages')) {
      return handleMessages(config, init, innerFetch)
    }
    return anthropicErrorResponse(404, `Endpoint ${pathname} is not supported by the ${config.kind} provider`)
  }
}
