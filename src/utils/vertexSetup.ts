import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { ClientOptions as VertexClientOptions } from '@anthropic-ai/vertex-sdk'
import type { GoogleAuth } from 'google-auth-library'

import { ALL_MODEL_CONFIGS, type ModelKey } from './model/configs.js'
import { getProxyFetchOptions } from './proxy.js'

/** How the wizard authenticates to Google Cloud. */
export type VertexAuthMethod = 'adc' | 'serviceAccount' | 'environment'

/** Everything the wizard collects across its steps. */
export type VertexSetupData = {
  authMethod?: VertexAuthMethod
  keyFile?: string
  projectId?: string
  region?: string
  verifiedIdentity?: string
  pinSonnet?: string
  pinOpus?: string
  pinHaiku?: string
}

/** Indices of the wizard steps, used for cross-step jumps. */
export const VERTEX_STEP = {
  AUTH_METHOD: 0,
  SERVICE_ACCOUNT: 1,
  PROJECT: 2,
  REGION: 3,
  VERIFY: 4,
  PIN_MODELS: 5,
  CONFIRM: 6,
} as const

const CREDENTIAL_TIMEOUT_MS = 12000
const PROJECT_LINE_LIMIT = 12
const VERTEX_SCOPES = ['https://www.googleapis.com/auth/cloud-platform']

export const ADC_LOGIN_COMMAND = 'gcloud auth application-default login'
export const MANUAL_PROJECT = '__manual__'

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

export type ModelTestReason = 'auth' | 'permission' | 'model' | 'network' | 'other'

export type ModelTestResult = { ok: true } | { ok: false; reason: ModelTestReason }

export const MODEL_TEST_REASON_LABELS: Record<ModelTestReason, string> = {
  auth: 'auth failed',
  permission: 'no aiplatform.endpoints.predict permission',
  model: 'not enabled in this project',
  network: 'unreachable',
  other: 'request failed',
}

/** Built-in Vertex model id per tier. */
export function getDefaultVertexModels(): Record<ModelTier, string> {
  const forTier = (key: ModelKey): string => ALL_MODEL_CONFIGS[key].vertex ?? ''
  return {
    sonnet: forTier(TIER_MODEL_KEYS.sonnet),
    opus: forTier(TIER_MODEL_KEYS.opus),
    haiku: forTier(TIER_MODEL_KEYS.haiku),
  }
}

/** Every Vertex model id that names the tier, best (newest) first. */
export function getVertexModelOptionsForTier(tier: ModelTier): string[] {
  const ids = new Set<string>()
  for (const config of Object.values(ALL_MODEL_CONFIGS)) {
    if (config.vertex?.toLowerCase().includes(tier)) ids.add(config.vertex)
  }
  return [...ids].toSorted().toReversed()
}

/**
 * Projects referenced by gcloud's active configurations plus the ADC file's
 * quota_project_id. Mirrors `gcloud config list` discovery without running it.
 */
export async function discoverGcpProjects(): Promise<string[]> {
  const projects = new Set<string>()
  const gcloudDir = process.env.CLOUDSDK_CONFIG ?? defaultGcloudDir()
  try {
    const configDir = join(gcloudDir, 'configurations')
    for (const entry of await readdir(configDir)) {
      if (!entry.startsWith('config_')) continue
      try {
        const content = await readFile(join(configDir, entry), 'utf8')
        for (const match of content.matchAll(/^project\s*=\s*(\S+)/gm)) {
          const project = match[1]?.trim()
          if (project) projects.add(project)
        }
      } catch {
        // Unreadable config file — skip it.
      }
    }
  } catch {
    // No configurations directory — fall through to the ADC probe.
  }
  try {
    const adc: unknown = JSON.parse(await readFile(join(gcloudDir, 'application_default_credentials.json'), 'utf8'))
    if (adc && typeof adc === 'object' && 'quota_project_id' in adc) {
      const quota = adc.quota_project_id
      if (typeof quota === 'string' && quota) projects.add(quota)
    }
  } catch {
    // Missing/unreadable ADC file — the project simply isn't discovered there.
  }
  return [...projects].toSorted()
}

function defaultGcloudDir(): string {
  if (process.platform === 'win32' && process.env.APPDATA) return join(process.env.APPDATA, 'gcloud')
  return join(homedir(), '.config', 'gcloud')
}

export function hasManyProjects(projects: string[]): boolean {
  return projects.length > PROJECT_LINE_LIMIT
}

type VertexAuthSpec = { kind: 'keyFile'; path: string } | { kind: 'default' }

function vertexAuthSpec(data: VertexSetupData): VertexAuthSpec {
  if (data.authMethod === 'serviceAccount' && data.keyFile) return { kind: 'keyFile', path: data.keyFile }
  return { kind: 'default' }
}

async function createGoogleAuth(spec: VertexAuthSpec, projectId: string | undefined): Promise<GoogleAuth> {
  const { GoogleAuth } = await import('google-auth-library')
  return new GoogleAuth({
    scopes: VERTEX_SCOPES,
    ...(spec.kind === 'keyFile' ? { keyFilename: spec.path } : {}),
    ...(projectId ? { projectId } : {}),
  })
}

async function createVertexMessagesClient(data: VertexSetupData) {
  const { AnthropicVertex } = await import('@anthropic-ai/vertex-sdk')
  const googleAuth = await createGoogleAuth(vertexAuthSpec(data), data.projectId)
  const args: VertexClientOptions = {
    region: data.region ?? 'global',
    projectId: data.projectId,
    // Two copies of google-auth-library under Bun's isolated install make their
    // GoogleAuth classes nominally incompatible; the SDK only duck-types
    // getClient() at runtime, so the instance is correct.
    googleAuth: googleAuth as unknown as VertexClientOptions['googleAuth'],
    maxRetries: 0,
    timeout: 15000,
    fetchOptions: getProxyFetchOptions(),
  }
  return new AnthropicVertex(args)
}

/** One-token probe: proves the credentials and that this model is callable. */
export async function testVertexModel(data: VertexSetupData, modelId: string): Promise<ModelTestResult> {
  let client: Awaited<ReturnType<typeof createVertexMessagesClient>>
  try {
    client = await createVertexMessagesClient(data)
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

export type VertexVerification =
  | { status: 'ok'; identity: string; note?: string }
  | { status: 'error'; error: string; command?: string }

async function describeIdentity(data: VertexSetupData): Promise<string> {
  const auth = await createGoogleAuth(vertexAuthSpec(data), data.projectId)
  const tokenPromise = (async () => {
    await (await auth.getClient()).getAccessToken()
  })()
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Timed out waiting for GCP credentials')), CREDENTIAL_TIMEOUT_MS)
  })
  await Promise.race([tokenPromise, timeoutPromise])
  let email: string | null | undefined
  try {
    email = (await auth.getCredentials()).client_email
  } catch {
    email = undefined
  }
  if (email) return email
  return data.authMethod === 'serviceAccount' ? `service account (${data.keyFile})` : 'Application Default Credentials'
}

/** Resolves credentials (with a timeout) then probes a haiku model. */
export async function verifyVertexCredentials(data: VertexSetupData): Promise<VertexVerification> {
  let identity: string
  try {
    identity = await describeIdentity(data)
  } catch (error) {
    return { status: 'error', ...describeGcpError(error, data) }
  }

  const model = getDefaultVertexModels().haiku
  const result = await testVertexModel(data, model)
  if (result.ok) {
    return { status: 'ok', identity, note: `Test request to ${model} succeeded.` }
  }
  switch (result.reason) {
    case 'auth':
      return {
        status: 'error',
        error: 'Got a token, but Vertex AI rejected it. The credential may lack the cloud-platform scope.',
      }
    case 'permission':
      return {
        status: 'error',
        error: `Permission denied calling Vertex AI in project "${data.projectId}". The principal needs the aiplatform.endpoints.predict permission (Vertex AI User role), and the Vertex AI API must be enabled.`,
      }
    case 'model':
      return {
        status: 'ok',
        identity,
        note: `Credentials work, but ${model} returned not-found in ${data.region}. Pin a model you have access to on the next step, or try the 'global' region.`,
      }
    case 'network':
      return {
        status: 'error',
        error: `Could not reach Vertex AI in region "${data.region}". Check the region name and your network.`,
      }
    case 'other':
      return {
        status: 'ok',
        identity,
        note: `Credentials work, but the test request to ${model} failed. You can pin a different model on the next step.`,
      }
  }
}

function describeGcpError(error: unknown, data: VertexSetupData): { error: string; command?: string } {
  const message = (error as { message?: string })?.message ?? String(error)
  if (data.authMethod === 'serviceAccount' && /ENOENT|no such file/i.test(message)) {
    return { error: `Service account key file not found: ${data.keyFile}` }
  }
  if (/Could not load the default credentials/i.test(message)) {
    return data.authMethod === 'adc'
      ? { error: 'No Application Default Credentials found. Run:', command: ADC_LOGIN_COMMAND }
      : {
          error:
            'No GCP credentials found in the environment. Set GOOGLE_APPLICATION_CREDENTIALS or run gcloud auth application-default login.',
        }
  }
  if (/invalid_grant|Token has been expired|reauth/i.test(message)) {
    if (data.authMethod === 'serviceAccount') {
      return {
        error:
          'Service account credentials have been revoked or expired. Obtain a new key file from GCP IAM (IAM → Service Accounts → Keys → Add Key).',
      }
    }
    if (data.authMethod === 'adc') {
      return { error: 'GCP credentials expired. Run:', command: ADC_LOGIN_COMMAND }
    }
    return {
      error:
        'GCP credentials in the environment have expired or been revoked. Refresh them (gcloud auth application-default login for ADC, or replace the GOOGLE_APPLICATION_CREDENTIALS key file).',
    }
  }
  if (/Unable to detect a Project Id/i.test(message)) {
    return {
      error: 'Could not determine a GCP project from the credentials. Go back and set the project ID explicitly.',
    }
  }
  if (/Timed out waiting for GCP/i.test(message)) {
    return {
      error: 'Timed out resolving GCP credentials (no ADC, no key file, and no GCE metadata server).',
      ...(data.authMethod === 'adc' && { command: ADC_LOGIN_COMMAND }),
    }
  }
  return { error: message }
}

/** The `env` block written to userSettings; undefined values are dropped. */
export function buildVertexEnv(data: VertexSetupData): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    CLAUDE_CODE_USE_VERTEX: '1',
    CLAUDE_CODE_USE_BEDROCK: undefined,
    CLAUDE_CODE_USE_FOUNDRY: undefined,
    CLAUDE_CODE_USE_ANTHROPIC_AWS: undefined,
    ANTHROPIC_VERTEX_PROJECT_ID: data.projectId,
    CLOUD_ML_REGION: data.region,
    GOOGLE_APPLICATION_CREDENTIALS: undefined,
    ANTHROPIC_DEFAULT_SONNET_MODEL: undefined,
    ANTHROPIC_DEFAULT_OPUS_MODEL: undefined,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: undefined,
    ANTHROPIC_SMALL_FAST_MODEL: undefined,
  }
  if (data.authMethod === 'serviceAccount') env.GOOGLE_APPLICATION_CREDENTIALS = data.keyFile
  if (data.pinSonnet) env.ANTHROPIC_DEFAULT_SONNET_MODEL = data.pinSonnet
  if (data.pinOpus) env.ANTHROPIC_DEFAULT_OPUS_MODEL = data.pinOpus
  if (data.pinHaiku) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = data.pinHaiku
  return env
}
