/**
 * `claude environment-runner` — the headless BYOC (Bring Your Own Container)
 * session runner.
 *
 * The Go `environment-manager` provisions the container, clones the workspace,
 * and hands this process a base64url work secret plus a session id. The runner
 * decodes the secret, stamps the child environment (BYOC markers, session
 * ingress token, runner version), picks the v1 Session-Ingress or CCR v2
 * transport, then spawns the Claude Code CLI in `--sdk-url` print mode and
 * supervises it until exit.
 *
 * The child's `RemoteIO` talks to Session Ingress / CCR directly, so the runner
 * never relays permissions or model traffic itself — model credentials are
 * bootstrap-persisted from the FD files so the child (and its subprocesses) can
 * read them.
 */

import type { WorkSecret } from '../bridge/types.js'
import { decodeWorkSecret, registerWorker as registerSessionWorker } from '../bridge/workSecret.js'
import { getApiKeyFromFileDescriptor, getOAuthTokenFromFileDescriptor } from '../utils/authFileDescriptor.js'
import { buildCliLaunch } from '../utils/cliLaunch.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import {
  buildChildArgs,
  buildChildEnv,
  parseRunnerArgs,
  prepareTransport,
  readWorkSecretString,
  resolveSessionId,
} from './config.js'
import {
  executeSession,
  type ExecuteSessionOptions,
  type SessionExecutionResult,
  type SessionLaunch,
} from './sessionExecutor.js'

export interface EnvironmentRunnerDeps {
  env: () => Record<string, string | undefined>
  runnerVersion: string
  argvLaunch: (extraArgs: string[]) => SessionLaunch
  registerWorker: (sdkUrl: string, token: string) => Promise<number>
  bootstrapCredentials: () => void
  executeSession: (options: ExecuteSessionOptions) => Promise<SessionExecutionResult>
}

/**
 * Read the FD-backed model credentials once. On success
 * `authFileDescriptor.ts` persists them to `/home/claude/.claude/remote/…` so
 * the spawned child — which cannot inherit the pipe FD across exec — can find
 * them. Failures are non-fatal: credentials may already be present as env vars.
 */
function bootstrapModelCredentials(): void {
  const readers = [
    ['OAuth token', getOAuthTokenFromFileDescriptor],
    ['API key', getApiKeyFromFileDescriptor],
  ] as const
  for (const [label, read] of readers) {
    try {
      read()
    } catch (error) {
      logForDebugging(`[environment-runner] ${label} bootstrap failed: ${errorMessage(error)}`)
    }
  }
}

function defaultDeps(): EnvironmentRunnerDeps {
  return {
    env: () => process.env,
    runnerVersion: MACRO.VERSION,
    argvLaunch: (extraArgs) => buildCliLaunch(extraArgs),
    registerWorker: (sdkUrl, token) => registerSessionWorker(sdkUrl, token),
    bootstrapCredentials: bootstrapModelCredentials,
    executeSession,
  }
}

/**
 * Run one BYOC session and return the process exit code (0 completed,
 * 130 interrupted, 1 failed). Exposed separately from `environmentRunnerMain`
 * so it can be driven without `process.exit` from tests.
 */
export async function runEnvironmentRunner(
  args: string[],
  overrides: Partial<EnvironmentRunnerDeps> = {},
): Promise<number> {
  const deps: EnvironmentRunnerDeps = { ...defaultDeps(), ...overrides }
  const env = deps.env()
  const parsed = parseRunnerArgs(args)
  if (parsed.help) {
    printUsage()
    return 0
  }

  const rawSecret = readWorkSecretString(parsed, env)
  if (!rawSecret) {
    throw new Error(
      'environment-runner requires a work secret (--work-secret, --work-secret-file, or CLAUDE_CODE_WORK_SECRET)',
    )
  }
  const secret: WorkSecret = decodeWorkSecret(rawSecret)

  const sessionId = resolveSessionId(parsed, env)
  if (!sessionId) {
    throw new Error('environment-runner requires a session id (--session-id or CLAUDE_CODE_REMOTE_SESSION_ID)')
  }

  deps.bootstrapCredentials()

  const transport = await prepareTransport(
    {
      secret,
      sessionId,
      apiBaseUrl: parsed.apiBaseUrl ?? secret.api_base_url,
      sdkUrlOverride: parsed.sdkUrl,
    },
    { registerWorker: deps.registerWorker },
  )

  const childEnv = buildChildEnv({
    baseEnv: env,
    secret,
    sessionId,
    runnerVersion: deps.runnerVersion,
    useCcrV2: transport.useCcrV2,
    workerEpoch: transport.workerEpoch,
  })

  const childArgs = buildChildArgs({
    secret,
    sdkUrl: transport.sdkUrl,
    sessionId,
    permissionMode: parsed.permissionMode,
    dangerouslySkipPermissions: parsed.dangerouslySkipPermissions,
    debugFile: parsed.debugFile,
    verbose: parsed.verbose,
  })

  const result = await deps.executeSession({
    launch: deps.argvLaunch(childArgs),
    cwd: parsed.cwd ?? process.cwd(),
    env: childEnv as NodeJS.ProcessEnv,
  })

  return result.status === 'completed' ? 0 : result.status === 'interrupted' ? 130 : 1
}

/** CLI entry point: run, then exit explicitly (a headless runner owns its loop). */
export async function environmentRunnerMain(args: string[]): Promise<void> {
  try {
    const code = await runEnvironmentRunner(args)
    process.exit(code)
  } catch (error) {
    console.error(`environment-runner: ${errorMessage(error)}`)
    process.exit(1)
  }
}

function printUsage(): void {
  console.log(
    [
      'Usage: claude environment-runner [options]',
      '',
      'Headless BYOC session runner: executes one Claude Code session inside a',
      'managed container against Session Ingress / CCR.',
      '',
      'Options:',
      '  --work-secret <b64>        Base64url work secret (or CLAUDE_CODE_WORK_SECRET)',
      '  --work-secret-file <path>  File containing the base64url work secret',
      '  --session-id <id>          Session id (or CLAUDE_CODE_REMOTE_SESSION_ID)',
      "  --api-base-url <url>       Override the secret's api_base_url",
      '  --sdk-url <url>            Override the computed ingress URL',
      '  --cwd <dir>                Workspace directory (default: cwd)',
      '  --permission-mode <mode>   Child permission mode',
      '  --dangerously-skip-permissions',
      '  --debug-file <path>        Child debug log path',
      '  --verbose                  Verbose child output',
      '  -h, --help',
    ].join('\n'),
  )
}
