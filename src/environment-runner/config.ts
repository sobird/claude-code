/**
 * Pure configuration helpers for the BYOC environment runner.
 *
 * The runner runs inside a customer-managed container (brought up by the Go
 * `environment-manager`). It is handed a base64url work secret plus a session
 * id, and must turn those into (a) the child CLI invocation and (b) the child
 * environment that points the session at Session Ingress / CCR.
 *
 * Everything here is side-effect light and unit-testable: arg/secret parsing,
 * `claude_code_args` expansion, `byoc` env stamping, and v1/v2 transport
 * selection. The actual spawning lives in `sessionExecutor.ts`.
 */

import { readFileSync } from 'node:fs'

import type { WorkSecret } from '../bridge/types.js'
import { buildCCRv2SdkUrl, buildSdkUrl } from '../bridge/workSecret.js'
import { jsonStringify } from '../utils/slowOperations.js'

export interface RunnerArgs {
  workSecret?: string
  workSecretFile?: string
  sessionId?: string
  apiBaseUrl?: string
  sdkUrl?: string
  cwd?: string
  permissionMode?: string
  dangerouslySkipPermissions: boolean
  debugFile?: string
  verbose: boolean
  help: boolean
}

type ValueFlagKey =
  | 'workSecret'
  | 'workSecretFile'
  | 'sessionId'
  | 'apiBaseUrl'
  | 'sdkUrl'
  | 'cwd'
  | 'permissionMode'
  | 'debugFile'

const VALUE_FLAGS: Record<string, ValueFlagKey> = {
  '--work-secret': 'workSecret',
  '--work-secret-file': 'workSecretFile',
  '--session-id': 'sessionId',
  '--api-base-url': 'apiBaseUrl',
  '--sdk-url': 'sdkUrl',
  '--cwd': 'cwd',
  '--permission-mode': 'permissionMode',
  '--debug-file': 'debugFile',
}

/** Parse `claude environment-runner` flags. Unknown flags are ignored. */
export function parseRunnerArgs(args: string[]): RunnerArgs {
  const parsed: RunnerArgs = {
    dangerouslySkipPermissions: false,
    verbose: false,
    help: false,
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      parsed.help = true
      continue
    }
    if (arg === '--dangerously-skip-permissions') {
      parsed.dangerouslySkipPermissions = true
      continue
    }
    if (arg === '--verbose') {
      parsed.verbose = true
      continue
    }
    const field = VALUE_FLAGS[arg]
    if (field) {
      const value = args[i + 1]
      if (value !== undefined) {
        parsed[field] = value
        i++
      }
    }
  }
  return parsed
}

/**
 * Resolve the raw base64url work secret, in priority order:
 * `--work-secret` → `--work-secret-file` → `CLAUDE_CODE_WORK_SECRET` →
 * `CLAUDE_CODE_WORK_SECRET_FILE`.
 */
export function readWorkSecretString(args: RunnerArgs, env: Record<string, string | undefined>): string | null {
  if (args.workSecret?.trim()) return args.workSecret.trim()
  if (args.workSecretFile) return readSecretFile(args.workSecretFile)
  if (env.CLAUDE_CODE_WORK_SECRET?.trim()) return env.CLAUDE_CODE_WORK_SECRET.trim()
  if (env.CLAUDE_CODE_WORK_SECRET_FILE) return readSecretFile(env.CLAUDE_CODE_WORK_SECRET_FILE)
  return null
}

function readSecretFile(path: string): string | null {
  const value = readFileSync(path, 'utf-8').trim()
  return value.length > 0 ? value : null
}

/** `--session-id` wins over `CLAUDE_CODE_REMOTE_SESSION_ID`. */
export function resolveSessionId(args: RunnerArgs, env: Record<string, string | undefined>): string | null {
  return args.sessionId?.trim() || env.CLAUDE_CODE_REMOTE_SESSION_ID?.trim() || null
}

/**
 * Expand the server-provided `claude_code_args` map into CLI flags. Keys
 * without a leading `-` gain `--`; `"true"`/empty values become bare flags and
 * `"false"` values are dropped.
 */
export function expandClaudeCodeArgs(map: Record<string, string> | null | undefined): string[] {
  if (!map) return []
  const args: string[] = []
  for (const [rawKey, rawValue] of Object.entries(map)) {
    if (rawValue === undefined || rawValue === null) continue
    const key = rawKey.startsWith('-') ? rawKey : `--${rawKey}`
    const value = rawValue
    if (value === '' || value.toLowerCase() === 'true') {
      args.push(key)
    } else if (value.toLowerCase() === 'false') {
      continue
    } else {
      args.push(key, value)
    }
  }
  return args
}

export interface BuildChildArgsInput {
  secret: WorkSecret
  sdkUrl: string
  sessionId: string
  permissionMode?: string
  dangerouslySkipPermissions: boolean
  debugFile?: string
  verbose: boolean
}

/** Build the child CLI argv: SDK stream-json mode against the ingress URL. */
export function buildChildArgs(input: BuildChildArgsInput): string[] {
  const args = [
    '--print',
    '--sdk-url',
    input.sdkUrl,
    '--session-id',
    input.sessionId,
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--replay-user-messages',
  ]
  if (input.verbose) args.push('--verbose')
  if (input.debugFile) args.push('--debug-file', input.debugFile)
  if (input.dangerouslySkipPermissions) args.push('--dangerously-skip-permissions')
  else if (input.permissionMode) args.push('--permission-mode', input.permissionMode)
  args.push(...expandClaudeCodeArgs(input.secret.claude_code_args))
  if (input.secret.mcp_config) args.push('--mcp-config', jsonStringify(input.secret.mcp_config))
  return args
}

export interface BuildChildEnvInput {
  baseEnv: Record<string, string | undefined>
  secret: WorkSecret
  sessionId: string
  runnerVersion: string
  useCcrV2: boolean
  workerEpoch?: number
}

/**
 * Build the child environment. Stamps the `byoc` environment kind (drives file
 * persistence), the remote/session markers, the session ingress token, and the
 * runner version header. Server-provided `environment_variables` are applied
 * last so they can override anything inherited.
 */
export function buildChildEnv(input: BuildChildEnvInput): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(input.baseEnv)) {
    if (value !== undefined) env[key] = value
  }

  env.CLAUDE_CODE_ENVIRONMENT_KIND = 'byoc'
  env.CLAUDE_CODE_REMOTE = '1'
  env.CLAUDE_CODE_REMOTE_SESSION_ID = input.sessionId
  env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = input.secret.session_ingress_token
  env.CLAUDE_CODE_ENVIRONMENT_RUNNER_VERSION = input.runnerVersion
  // v1 transport reads over WebSocket and writes over POST to Session Ingress.
  // Harmless in v2 mode, where the transport checks CLAUDE_CODE_USE_CCR_V2 first.
  env.CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2 = '1'

  if (input.useCcrV2) {
    env.CLAUDE_CODE_USE_CCR_V2 = '1'
    if (input.workerEpoch !== undefined) env.CLAUDE_CODE_WORKER_EPOCH = String(input.workerEpoch)
  }

  const serverEnv = input.secret.environment_variables
  if (serverEnv) {
    for (const [key, value] of Object.entries(serverEnv)) {
      if (typeof value === 'string') env[key] = value
    }
  }
  return env
}

export interface SessionTransport {
  sdkUrl: string
  useCcrV2: boolean
  workerEpoch?: number
}

export interface PrepareTransportInput {
  secret: WorkSecret
  sessionId: string
  apiBaseUrl: string
  sdkUrlOverride?: string
}

export interface PrepareTransportDeps {
  registerWorker: (sdkUrl: string, token: string) => Promise<number>
}

/**
 * Pick the transport URL. An explicit `--sdk-url` always wins. Otherwise the
 * server's `use_code_sessions` selector chooses CCR v2 (which also needs a
 * `POST /worker/register` to obtain the worker epoch); the default is the v1
 * Session-Ingress WebSocket URL.
 */
export async function prepareTransport(
  input: PrepareTransportInput,
  deps: PrepareTransportDeps,
): Promise<SessionTransport> {
  if (input.sdkUrlOverride) {
    return { sdkUrl: input.sdkUrlOverride, useCcrV2: false }
  }
  if (input.secret.use_code_sessions === true) {
    const sdkUrl = buildCCRv2SdkUrl(input.apiBaseUrl, input.sessionId)
    const workerEpoch = await deps.registerWorker(sdkUrl, input.secret.session_ingress_token)
    return { sdkUrl, useCcrV2: true, workerEpoch }
  }
  return { sdkUrl: buildSdkUrl(input.apiBaseUrl, input.sessionId), useCcrV2: false }
}
