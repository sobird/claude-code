import { afterEach, describe, expect, test } from 'bun:test'

import { createAnthropicAwsClient } from '../anthropicAws.js'

const ENV_KEYS = [
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'ANTHROPIC_AWS_API_KEY',
  'ANTHROPIC_AWS_BASE_URL',
  'ANTHROPIC_AWS_WORKSPACE_ID',
  // The SDK reads these ambiently; clear them so assertions see only the
  // credentials this test configures.
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
] as const

const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

function clearAwsEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
}

afterEach(() => {
  clearAwsEnv()
  for (const key of ENV_KEYS) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key]
    }
  }
})

const MESSAGE_BODY = JSON.stringify({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-6',
  content: [],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
})

type CapturedRequest = { url: string; headers: Headers; body: string | null }

function fakeFetch(captured: CapturedRequest[]) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    captured.push({
      url: input instanceof Request ? input.url : input instanceof URL ? input.href : input,
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    })
    return new Response(MESSAGE_BODY, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
}

async function sendMessage(client: ReturnType<typeof createAnthropicAwsClient>): Promise<void> {
  await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16,
    messages: [{ role: 'user', content: 'hi' }],
  })
}

describe('createAnthropicAwsClient configuration', () => {
  test('requires a region, base URL, or explicit skipAuth', () => {
    clearAwsEnv()
    expect(() => createAnthropicAwsClient({ workspaceId: 'ws' })).toThrow(/No AWS region or base URL found/)
  })

  test('requires a workspace ID unless auth is skipped', () => {
    clearAwsEnv()
    expect(() => createAnthropicAwsClient({ awsRegion: 'us-east-1' })).toThrow(/No workspace ID found/)
  })

  test('rejects a partial explicit key pair', () => {
    clearAwsEnv()
    expect(() => createAnthropicAwsClient({ awsRegion: 'us-east-1', workspaceId: 'ws', awsAccessKey: 'AKID' })).toThrow(
      /must be provided together/,
    )
  })

  test('skipAuth bypasses region and workspace requirements', () => {
    clearAwsEnv()
    expect(() => createAnthropicAwsClient({ skipAuth: true })).not.toThrow()
  })
})

describe('createAnthropicAwsClient signing', () => {
  test('signs with SigV4 and sends the workspace header', async () => {
    clearAwsEnv()
    const captured: CapturedRequest[] = []
    const client = createAnthropicAwsClient({
      awsRegion: 'us-east-1',
      workspaceId: 'ws-123',
      awsAccessKey: 'AKIDEXAMPLE',
      awsSecretAccessKey: 'secret',
      awsSessionToken: 'session-token',
      baseURL: 'https://example.test',
      maxRetries: 0,
      fetch: fakeFetch(captured),
    })

    await sendMessage(client)

    expect(captured).toHaveLength(1)
    const { headers, body } = captured[0]
    expect(headers.get('anthropic-workspace-id')).toBe('ws-123')
    expect(headers.get('x-api-key')).toBeNull()
    expect(headers.get('x-amz-security-token')).toBe('session-token')
    expect(headers.get('x-amz-date')).toMatch(/^\d{8}T\d{6}Z$/)
    expect(headers.get('authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/aws-external-anthropic\/aws4_request, SignedHeaders=.*, Signature=[0-9a-f]{64}$/,
    )
    // The SDK serializes the JSON body before calling fetch; the signature
    // must therefore hash the exact bytes that go on the wire.
    expect(body).toContain('claude-sonnet-4-6')
  })

  test('omits the session token header when no token is configured', async () => {
    clearAwsEnv()
    const captured: CapturedRequest[] = []
    const client = createAnthropicAwsClient({
      awsRegion: 'us-east-1',
      workspaceId: 'ws-123',
      awsAccessKey: 'AKIDEXAMPLE',
      awsSecretAccessKey: 'secret',
      baseURL: 'https://example.test',
      maxRetries: 0,
      fetch: fakeFetch(captured),
    })

    await sendMessage(client)

    expect(captured[0].headers.get('x-amz-security-token')).toBeNull()
    expect(captured[0].headers.get('authorization')).toContain('Credential=AKIDEXAMPLE/')
  })

  test('uses ANTHROPIC_AWS_API_KEY when no explicit credentials are given', async () => {
    clearAwsEnv()
    process.env.ANTHROPIC_AWS_API_KEY = 'sk-aws-test'
    const captured: CapturedRequest[] = []
    const client = createAnthropicAwsClient({
      awsRegion: 'us-east-1',
      workspaceId: 'ws-123',
      baseURL: 'https://example.test',
      maxRetries: 0,
      fetch: fakeFetch(captured),
    })

    await sendMessage(client)

    expect(captured[0].headers.get('x-api-key')).toBe('sk-aws-test')
    expect(captured[0].headers.get('authorization')).toBeNull()
    expect(captured[0].headers.get('anthropic-workspace-id')).toBe('ws-123')
  })

  test('reads region and workspace ID from env when not passed explicitly', async () => {
    clearAwsEnv()
    process.env.AWS_REGION = 'eu-west-1'
    process.env.ANTHROPIC_AWS_WORKSPACE_ID = 'ws-env'
    process.env.ANTHROPIC_AWS_API_KEY = 'sk-aws-test'
    const captured: CapturedRequest[] = []
    const client = createAnthropicAwsClient({
      baseURL: 'https://example.test',
      maxRetries: 0,
      fetch: fakeFetch(captured),
    })

    await sendMessage(client)

    expect(captured[0].headers.get('anthropic-workspace-id')).toBe('ws-env')
    expect(captured[0].headers.get('x-api-key')).toBe('sk-aws-test')
  })
})
