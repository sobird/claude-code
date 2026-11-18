import { createHash, createHmac } from 'node:crypto'

import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk'

import { logForDebugging } from '../../utils/debug.js'

/**
 * Claude Platform on AWS (`anthropicAws`) client.
 *
 * The Anthropic SDK build used by this repo does not ship an `AnthropicAws`
 * class and the smithy signing packages are not direct dependencies, so this
 * module recreates the upstream client: it configures a plain `Anthropic`
 * client and, when no API key is available, signs every request with SigV4 in
 * a fetch wrapper. The wire behavior matches upstream — service name
 * `aws-external-anthropic`, the `anthropic-workspace-id` header, and either
 * `ANTHROPIC_AWS_API_KEY` or the ambient AWS credential chain.
 */

const SERVICE_NAME = 'aws-external-anthropic'

// AWS SigV4 headers that must never be part of the signed header set.
const UNSIGNABLE_HEADERS = new Set([
  'authorization',
  'cache-control',
  'connection',
  'expect',
  'from',
  'keep-alive',
  'max-forwards',
  'pragma',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
  'x-amzn-trace-id',
])

const EMPTY_BODY_SHA256 = createHash('sha256').update('').digest('hex')

export interface AwsCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

type ProviderChainResolver = () => Promise<() => Promise<AwsCredentials>>

export interface AnthropicAwsClientOptions extends ClientOptions {
  awsRegion?: string
  awsAccessKey?: string | null
  awsSecretAccessKey?: string | null
  awsSessionToken?: string | null
  awsProfile?: string
  providerChainResolver?: ProviderChainResolver
  workspaceId?: string
  skipAuth?: boolean
}

interface SignerConfig {
  serviceName: string
  regionName: string
  awsAccessKey: string | null
  awsSecretAccessKey: string | null
  awsSessionToken: string | null
  awsProfile: string | undefined
  providerChainResolver: ProviderChainResolver | undefined
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

export function createAnthropicAwsClient({
  awsRegion,
  baseURL: explicitBaseURL,
  apiKey,
  awsAccessKey = null,
  awsSecretAccessKey = null,
  awsSessionToken = null,
  awsProfile,
  providerChainResolver,
  workspaceId,
  skipAuth = false,
  fetch: fetchOverride,
  ...rest
}: AnthropicAwsClientOptions): Anthropic {
  const region = awsRegion ?? readEnv('AWS_REGION') ?? readEnv('AWS_DEFAULT_REGION')
  const baseURL =
    explicitBaseURL ??
    readEnv('ANTHROPIC_AWS_BASE_URL') ??
    (region ? `https://${SERVICE_NAME}.${region}.api.aws` : undefined)
  if (!baseURL && !skipAuth) {
    throw new Error(
      'No AWS region or base URL found. Set `awsRegion` in the constructor, the `AWS_REGION` / `AWS_DEFAULT_REGION` environment variable, or provide a `baseURL` / `ANTHROPIC_AWS_BASE_URL` environment variable.',
    )
  }

  if ((awsAccessKey != null) !== (awsSecretAccessKey != null)) {
    throw new Error('`awsAccessKey` and `awsSecretAccessKey` must be provided together. You provided only one.')
  }

  const hasExplicitKeys = awsAccessKey != null && awsSecretAccessKey != null
  const hasProfile = awsProfile != null
  // The API key only applies when the caller hasn't opted into SigV4 via an
  // explicit key pair or profile (matching upstream resolution order).
  const resolvedApiKey = apiKey ?? (hasExplicitKeys || hasProfile ? undefined : readEnv('ANTHROPIC_AWS_API_KEY'))

  const resolvedWorkspaceId = workspaceId ?? readEnv('ANTHROPIC_AWS_WORKSPACE_ID')
  if (!resolvedWorkspaceId && !skipAuth) {
    throw new Error(
      'No workspace ID found. Set `workspaceId` in the constructor or the `ANTHROPIC_AWS_WORKSPACE_ID` environment variable.',
    )
  }

  const useSigV4 = resolvedApiKey == null
  const signing = useSigV4 && !skipAuth

  // Upstream AnthropicAws subclasses the SDK and no-ops `validateHeaders`.
  // With a plain client the supported equivalent is a null `authorization`
  // default header: the SDK records it as explicitly omitted (so it does not
  // demand apiKey/authToken) and emits nothing, then the signing fetch below
  // adds the AWS4-HMAC-SHA256 header.
  const defaultHeaders: Record<string, string | null | undefined> = {
    ...(rest.defaultHeaders as Record<string, string | null | undefined> | undefined),
    ...(resolvedWorkspaceId && { 'anthropic-workspace-id': resolvedWorkspaceId }),
    ...(signing && { authorization: null }),
  }

  return new Anthropic({
    ...rest,
    apiKey: resolvedApiKey ?? null,
    baseURL,
    // Sign only when no API key is available; otherwise pass a caller-supplied
    // fetch straight through (proxy fetch, test doubles).
    ...(signing
      ? {
          fetch: createSigV4Fetch(fetchOverride ?? globalThis.fetch, {
            serviceName: SERVICE_NAME,
            regionName: region ?? '',
            awsAccessKey,
            awsSecretAccessKey,
            awsSessionToken,
            awsProfile,
            providerChainResolver,
          }),
        }
      : fetchOverride
        ? { fetch: fetchOverride }
        : {}),
    ...(Object.keys(defaultHeaders).length > 0 && { defaultHeaders }),
  })
}

interface SignableRequest {
  url: string
  method: string
  headers: Record<string, string>
  payloadHash: string
}

function createSigV4Fetch(
  innerFetch: NonNullable<ClientOptions['fetch']>,
  config: SignerConfig,
): NonNullable<ClientOptions['fetch']> {
  return async (input, init) => {
    const request = await buildSignableRequest(input, init)
    const authHeaders = await signRequest(request, config)
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    for (const [name, value] of Object.entries(authHeaders)) {
      headers.set(name, value)
    }
    logForDebugging(`[API:AWS] SigV4 signed ${request.method} ${new URL(request.url).pathname}`)
    // Passing the original input (plus init) preserves a Request body that
    // wasn't supplied separately in init.
    return innerFetch(input, { ...init, headers })
  }
}

async function buildSignableRequest(
  input: string | URL | Request,
  init: RequestInit | undefined,
): Promise<SignableRequest> {
  const isRequest = input instanceof Request
  const url = new URL(isRequest ? input.url : String(input))
  const method = (init?.method ?? (isRequest ? input.method : 'GET')).toUpperCase()

  const source = new Headers(init?.headers ?? (isRequest ? input.headers : undefined))
  const headers: Record<string, string> = {}
  source.forEach((value, name) => {
    headers[name.toLowerCase()] = value
  })
  // The HTTP layer supplies the Host header; sign the value it will send.
  headers['host'] = url.host

  let payload: BodyInit | null | undefined = init?.body
  if (isRequest && payload == null) {
    payload = await input.clone().arrayBuffer()
  }

  return { url: url.toString(), method, headers, payloadHash: await hashPayload(payload) }
}

async function hashPayload(body: BodyInit | null | undefined): Promise<string> {
  if (body == null) {
    return EMPTY_BODY_SHA256
  }
  if (typeof body === 'string') {
    return sha256Hex(body)
  }
  if (body instanceof ArrayBuffer) {
    return sha256Hex(new Uint8Array(body))
  }
  if (ArrayBuffer.isView(body)) {
    return sha256Hex(new Uint8Array(body.buffer, body.byteOffset, body.byteLength))
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return sha256Hex(new Uint8Array(await body.arrayBuffer()))
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return sha256Hex(body.toString())
  }
  // Streaming / FormData bodies can't be hashed without consuming them. The
  // Messages API always sends serialized JSON strings, so this path is only a
  // safety net for future endpoints.
  logForDebugging('[API:AWS] Non-hashable request body; signing with UNSIGNED-PAYLOAD', { level: 'warn' })
  return 'UNSIGNED-PAYLOAD'
}

async function signRequest(request: SignableRequest, config: SignerConfig): Promise<Record<string, string>> {
  const credentials = await resolveCredentials(config)
  const parsedUrl = new URL(request.url)

  const now = new Date()
  const amzDate = formatAmzDate(now)
  const dateStamp = amzDate.slice(0, 8)

  const headersToSign: Record<string, string> = { ...request.headers, 'x-amz-date': amzDate }
  if (credentials.sessionToken) {
    headersToSign['x-amz-security-token'] = credentials.sessionToken
  }
  const { canonicalHeaders, signedHeaders } = buildCanonicalHeaders(headersToSign)

  const canonicalRequest = [
    request.method,
    canonicalUri(parsedUrl.pathname),
    canonicalQuery(parsedUrl.searchParams),
    canonicalHeaders,
    signedHeaders,
    request.payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${config.regionName}/${config.serviceName}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const signingKey = deriveSigningKey(credentials.secretAccessKey, dateStamp, config.regionName, config.serviceName)
  const signature = hmacHex(signingKey, stringToSign)

  return {
    'x-amz-date': amzDate,
    ...(credentials.sessionToken && { 'x-amz-security-token': credentials.sessionToken }),
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

async function resolveCredentials(config: SignerConfig): Promise<AwsCredentials> {
  if (config.awsAccessKey && config.awsSecretAccessKey) {
    return {
      accessKeyId: config.awsAccessKey,
      secretAccessKey: config.awsSecretAccessKey,
      ...(config.awsSessionToken != null && { sessionToken: config.awsSessionToken }),
    }
  }
  if (config.providerChainResolver) {
    const provider = await config.providerChainResolver()
    return provider()
  }
  return resolveCredentialsFromNodeProviderChain(config.awsProfile)
}

async function resolveCredentialsFromNodeProviderChain(profile: string | undefined): Promise<AwsCredentials> {
  let fromNodeProviderChain: typeof import('@aws-sdk/credential-providers').fromNodeProviderChain
  try {
    ;({ fromNodeProviderChain } = await import('@aws-sdk/credential-providers'))
  } catch (error) {
    throw new Error(
      `Failed to import '@aws-sdk/credential-providers'. You can provide a custom \`providerChainResolver\` in the client options if your runtime does not have access to '@aws-sdk/credential-providers': \`new AnthropicAws({ providerChainResolver })\`. Original error: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  const provider = fromNodeProviderChain(profile ? { profile } : {})
  return provider()
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function buildCanonicalHeaders(headers: Record<string, string>): {
  canonicalHeaders: string
  signedHeaders: string
} {
  const names = Object.keys(headers)
    .filter((name) => !UNSIGNABLE_HEADERS.has(name))
    .toSorted()
  const canonicalHeaders = names.map((name) => `${name}:${headers[name].trim().replace(/\s+/g, ' ')}\n`).join('')
  return { canonicalHeaders, signedHeaders: names.join(';') }
}

function canonicalUri(pathname: string): string {
  const path = pathname || '/'
  return path
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/')
}

function canonicalQuery(params: URLSearchParams): string {
  const pairs: Array<[string, string]> = []
  params.forEach((value, key) => {
    pairs.push([key, value])
  })
  pairs.sort(([aKey, aValue], [bKey, bValue]) => {
    if (aKey !== bKey) return aKey < bKey ? -1 : 1
    if (aValue === bValue) return 0
    return aValue < bValue ? -1 : 1
  })
  return pairs.map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`).join('&')
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

function hmacHex(key: Buffer, data: string): string {
  return createHmac('sha256', key).update(data, 'utf8').digest('hex')
}

function deriveSigningKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp)
  const regionKey = hmac(dateKey, region)
  const serviceKey = hmac(regionKey, service)
  return hmac(serviceKey, 'aws4_request')
}
