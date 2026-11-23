import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { ClientOptions as BedrockClientOptions } from '@anthropic-ai/bedrock-sdk'

import { getAWSRegion } from './envUtils.js'
import { applyBedrockRegionPrefix, findFirstMatch, type BedrockRegionPrefix } from './model/bedrock.js'
import { ALL_MODEL_CONFIGS, type ModelKey } from './model/configs.js'
import { getAWSClientProxyConfig, getProxyFetchOptions } from './proxy.js'

/** How the wizard authenticates to AWS. */
export type BedrockAuthMethod = 'profile' | 'bearer' | 'accessKey' | 'environment'

/** Everything the wizard collects across its steps. */
export type BedrockSetupData = {
  authMethod?: BedrockAuthMethod
  awsProfile?: string
  bearerToken?: string
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  region?: string
  verifiedIdentity?: string
  discoveredProfiles?: string[]
  pinSonnet?: string
  pinOpus?: string
  pinHaiku?: string
}

/** Indices of the wizard steps, used for cross-step jumps. */
export const BEDROCK_STEP = {
  AUTH_METHOD: 0,
  PROFILE: 1,
  BEARER: 2,
  ACCESS_KEY_ID: 3,
  SECRET_KEY: 4,
  SESSION_TOKEN: 5,
  REGION: 6,
  VERIFY: 7,
  PIN_MODELS: 8,
  CONFIRM: 9,
} as const

const PROFILE_LINE_LIMIT = 12
const SSO_SESSION_PREFIX = 'sso-session '

/**
 * Named profiles from ~/.aws/config and ~/.aws/credentials. SSO session
 * definitions (`[sso-session foo]`) are not usable as --profile values.
 */
export async function discoverAwsProfiles(): Promise<string[]> {
  const profiles = new Set<string>()
  const home = homedir()
  const sources = [
    { path: join(home, '.aws', 'config'), re: /^\[(?:profile\s+)?([^\]]+)\]/gm },
    { path: join(home, '.aws', 'credentials'), re: /^\[([^\]]+)\]/gm },
  ]
  for (const { path, re } of sources) {
    try {
      const content = await readFile(path, 'utf8')
      for (const match of content.matchAll(re)) {
        const name = match[1]?.trim()
        if (name && !name.startsWith(SSO_SESSION_PREFIX)) {
          profiles.add(name)
        }
      }
    } catch {
      // Missing/unreadable file — the profile simply isn't discovered there.
    }
  }
  return [...profiles].toSorted()
}

export function hasManyProfiles(profiles: string[]): boolean {
  return profiles.length > PROFILE_LINE_LIMIT
}

/** Region → Bedrock cross-region inference prefix (us-gov routes as global). */
export function getInferencePrefixForRegion(region: string | undefined): BedrockRegionPrefix {
  const value = region ?? ''
  if (value.startsWith('us-') && !value.startsWith('us-gov-')) return 'us'
  if (value.startsWith('eu-')) return 'eu'
  if (value.startsWith('ap-')) return 'apac'
  return 'global'
}

export const MODEL_TIERS = ['sonnet', 'opus', 'haiku'] as const

export type ModelTier = (typeof MODEL_TIERS)[number]

export const MODEL_TIER_LABELS: Record<ModelTier, string> = {
  sonnet: 'Sonnet',
  opus: 'Opus',
  haiku: 'Haiku',
}

const TIER_MODEL_KEYS: Record<ModelTier, ModelKey> = {
  sonnet: 'sonnet45',
  opus: 'opus46',
  haiku: 'haiku45',
}

export type ModelPinCandidate = { needle: string; fallback: string }

/**
 * Candidate model that Claude Code would pin per tier: the first-party id is
 * matched against the account's inference profiles; the fallback is the
 * built-in Bedrock id re-prefixed for the chosen region.
 */
export function getModelPinCandidates(region: string | undefined): Record<ModelTier, ModelPinCandidate> {
  const prefix = getInferencePrefixForRegion(region)
  const forTier = (key: ModelKey): ModelPinCandidate => ({
    needle: ALL_MODEL_CONFIGS[key].firstParty,
    fallback: applyBedrockRegionPrefix(ALL_MODEL_CONFIGS[key].bedrock, prefix),
  })
  return { sonnet: forTier(TIER_MODEL_KEYS.sonnet), opus: forTier('opus46'), haiku: forTier(TIER_MODEL_KEYS.haiku) }
}

export type ModelTestReason = 'auth' | 'permission' | 'model' | 'network' | 'other'

export type ModelTestResult = { ok: true } | { ok: false; reason: ModelTestReason }

export const MODEL_TEST_REASON_LABELS: Record<ModelTestReason, string> = {
  auth: 'auth failed',
  permission: 'no InvokeModel permission',
  model: 'not enabled in this account',
  network: 'unreachable',
  other: 'request failed',
}

type AwsCredentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string }

async function resolveAwsCredentials(data: BedrockSetupData): Promise<AwsCredentials | undefined> {
  switch (data.authMethod) {
    case 'profile': {
      const { fromNodeProviderChain } = await import('@aws-sdk/credential-providers')
      const provider = fromNodeProviderChain({ profile: data.awsProfile, ignoreCache: true })
      return provider()
    }
    case 'accessKey': {
      if (!data.accessKeyId || !data.secretAccessKey) return undefined
      return {
        accessKeyId: data.accessKeyId,
        secretAccessKey: data.secretAccessKey,
        ...(data.sessionToken && { sessionToken: data.sessionToken }),
      }
    }
    case 'environment': {
      const { fromNodeProviderChain } = await import('@aws-sdk/credential-providers')
      return fromNodeProviderChain()()
    }
    default:
      return undefined
  }
}

async function createBedrockMessagesClient(data: BedrockSetupData) {
  const { AnthropicBedrock } = await import('@anthropic-ai/bedrock-sdk')
  const base = {
    awsRegion: data.region ?? getAWSRegion(),
    maxRetries: 0,
    fetchOptions: getProxyFetchOptions({ forAnthropicAPI: true }) as BedrockClientOptions['fetchOptions'],
  }
  if (data.authMethod === 'bearer') {
    return new AnthropicBedrock({
      ...base,
      skipAuth: true,
      defaultHeaders: { Authorization: `Bearer ${data.bearerToken ?? ''}` },
    })
  }
  const credentials = await resolveAwsCredentials(data)
  if (!credentials) {
    return new AnthropicBedrock(base)
  }
  return new AnthropicBedrock({
    ...base,
    awsAccessKey: credentials.accessKeyId,
    awsSecretKey: credentials.secretAccessKey,
    awsSessionToken: credentials.sessionToken,
  })
}

/** One-token probe: proves the credentials and that this model is callable. */
export async function testBedrockModel(data: BedrockSetupData, modelId: string): Promise<ModelTestResult> {
  let client: Awaited<ReturnType<typeof createBedrockMessagesClient>>
  try {
    client = await createBedrockMessagesClient(data)
  } catch {
    return { ok: false, reason: 'auth' }
  }
  try {
    await client.messages.create({ model: modelId, max_tokens: 1, messages: [{ role: 'user', content: '.' }] })
    return { ok: true }
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 401) return { ok: false, reason: 'auth' }
    if (status === 403) return { ok: false, reason: 'permission' }
    if (status === 400 || status === 404) return { ok: false, reason: 'model' }
    if (status === 429) return { ok: true }
    if (status === undefined) return { ok: false, reason: 'network' }
    return { ok: false, reason: 'other' }
  }
}

export type BedrockVerification =
  | { status: 'ok'; identity: string; profiles: string[]; note?: string }
  | { status: 'error'; error: string; command?: string }

async function verifyBearer(data: BedrockSetupData): Promise<BedrockVerification> {
  const model = getModelPinCandidates(data.region).haiku.fallback
  const result = await testBedrockModel(data, model)
  if (result.ok) {
    return { status: 'ok', identity: 'Bedrock API key', profiles: [], note: `Test request to ${model} succeeded.` }
  }
  switch (result.reason) {
    case 'auth':
      return { status: 'error', error: 'Invalid Bedrock API key. Check the key and try again.' }
    case 'permission':
      return {
        status: 'error',
        error:
          'API key was rejected. Your IAM policy may be missing bedrock:CallWithBearerToken or bedrock:InvokeModel.',
      }
    case 'model':
      return {
        status: 'ok',
        identity: 'Bedrock API key',
        profiles: [],
        note: `The key works, but ${model} is not enabled in your account. Pin a model you have access to on the next step.`,
      }
    case 'network':
      return {
        status: 'error',
        error: `Could not reach Bedrock in region "${data.region}". Check the region name and your network.`,
      }
    case 'other':
      return { status: 'error', error: 'The test request failed. Check the key and region.' }
  }
}

function describeAwsError(error: unknown, data: BedrockSetupData): { error: string; command?: string } {
  const name = (error as { name?: string })?.name ?? 'Error'
  const message = (error as { message?: string })?.message ?? String(error)
  const ssoCommand = data.authMethod === 'profile' ? `aws sso login --profile ${data.awsProfile}` : undefined
  switch (name) {
    case 'CredentialsProviderError':
      return data.authMethod === 'profile'
        ? {
            error: `Could not load credentials for profile "${data.awsProfile}". If this is an SSO profile, run:`,
            command: ssoCommand,
          }
        : { error: `No AWS credentials found. ${message}` }
    case 'ExpiredTokenException':
    case 'TokenRefreshRequired':
      return data.authMethod === 'profile'
        ? { error: 'SSO session expired. Run:', command: ssoCommand }
        : { error: `Credentials expired. ${message}` }
    case 'ForbiddenException':
      return data.authMethod === 'profile'
        ? {
            error: `SSO portal denied access to the role for profile "${data.awsProfile}". The permission set may have been revoked — check your AWS access portal.`,
          }
        : { error: `Forbidden. ${message}` }
    case 'AccessDeniedException':
      return { error: `Access denied. Your IAM role needs bedrock:ListInferenceProfiles permission. ${message}` }
    case 'UnrecognizedClientException':
    case 'InvalidSignatureException':
      return { error: `Invalid credentials. ${message}` }
    case 'UnknownEndpoint':
    case 'ENOTFOUND':
      return {
        error: `Cannot reach AWS in region "${data.region}". Check the region name and your network.`,
      }
    default:
      return { error: `${name}: ${message}` }
  }
}

async function describeIdentityAndProfiles(data: BedrockSetupData): Promise<{ identity: string; profiles: string[] }> {
  const region = data.region ?? getAWSRegion()
  const credentials = await resolveAwsCredentials(data)
  const [{ STSClient, GetCallerIdentityCommand }, { BedrockClient, ListInferenceProfilesCommand }] = await Promise.all([
    import('@aws-sdk/client-sts'),
    import('@aws-sdk/client-bedrock'),
  ])
  const clientConfig = {
    ...(await getAWSClientProxyConfig()),
    region,
    ...(credentials && { credentials }),
  }
  const identityResponse = await new STSClient(clientConfig).send(new GetCallerIdentityCommand({}))
  const identity = identityResponse.Arn ?? identityResponse.UserId ?? '(unknown)'

  const profiles: string[] = []
  let nextToken: string | undefined
  const bedrock = new BedrockClient(clientConfig)
  do {
    const response = await bedrock.send(
      new ListInferenceProfilesCommand({ ...(nextToken && { nextToken }), typeEquals: 'SYSTEM_DEFINED' }),
    )
    for (const summary of response.inferenceProfileSummaries ?? []) {
      const id = summary.inferenceProfileId
      if (id?.includes('anthropic')) {
        profiles.push(id)
      }
    }
    nextToken = response.nextToken
  } while (nextToken)

  return { identity, profiles }
}

/** Calls AWS STS + Bedrock to prove the credentials and list model profiles. */
export async function verifyBedrockCredentials(data: BedrockSetupData): Promise<BedrockVerification> {
  if (data.authMethod === 'bearer') {
    return verifyBearer(data)
  }
  try {
    const { identity, profiles } = await describeIdentityAndProfiles(data)
    return { status: 'ok', identity, profiles }
  } catch (error) {
    return { status: 'error', ...describeAwsError(error, data) }
  }
}

/** The `env` block written to userSettings; undefined values are dropped. */
export function buildBedrockEnv(data: BedrockSetupData): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    CLAUDE_CODE_USE_BEDROCK: '1',
    AWS_REGION: data.region,
    AWS_PROFILE: undefined,
    AWS_BEARER_TOKEN_BEDROCK: undefined,
    AWS_ACCESS_KEY_ID: undefined,
    AWS_SECRET_ACCESS_KEY: undefined,
    AWS_SESSION_TOKEN: undefined,
    ANTHROPIC_DEFAULT_SONNET_MODEL: undefined,
    ANTHROPIC_DEFAULT_OPUS_MODEL: undefined,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: undefined,
  }
  switch (data.authMethod) {
    case 'profile':
      env.AWS_PROFILE = data.awsProfile
      break
    case 'bearer':
      env.AWS_BEARER_TOKEN_BEDROCK = data.bearerToken
      break
    case 'accessKey':
      env.AWS_ACCESS_KEY_ID = data.accessKeyId
      env.AWS_SECRET_ACCESS_KEY = data.secretAccessKey
      if (data.sessionToken) {
        env.AWS_SESSION_TOKEN = data.sessionToken
      }
      break
    case 'environment':
    case undefined:
      break
  }
  if (data.pinSonnet) env.ANTHROPIC_DEFAULT_SONNET_MODEL = data.pinSonnet
  if (data.pinOpus) env.ANTHROPIC_DEFAULT_OPUS_MODEL = data.pinOpus
  if (data.pinHaiku) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = data.pinHaiku
  return env
}

/** Env keys whose values must not be echoed back to the terminal. */
export const HIDDEN_ENV_KEYS = new Set(['AWS_BEARER_TOKEN_BEDROCK', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'])

/** Candidate list for the "choose different models" picker, best matches first. */
export function getModelOptionsForTier(
  tier: ModelTier,
  profiles: string[],
  fallback: string,
  current: string,
): string[] {
  const options = profiles
    .filter((profile) => profile.toLowerCase().includes(tier))
    .toSorted()
    .toReversed()
  if (!options.includes(fallback)) options.push(fallback)
  if (!options.includes(current)) options.push(current)
  return options
}

/** The first discovered profile matching a needle, else the built-in fallback. */
export function pickDefaultModel(
  profiles: string[],
  candidate: ModelPinCandidate,
): { model: string; fromAccount: boolean } {
  const match = findFirstMatch(profiles, candidate.needle)
  return match ? { model: match, fromAccount: true } : { model: candidate.fallback, fromAccount: false }
}
