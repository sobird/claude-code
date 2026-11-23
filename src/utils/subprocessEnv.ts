import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

/**
 * Env vars to strip from subprocess environments when running inside GitHub
 * Actions. This prevents prompt-injection attacks from exfiltrating secrets
 * via shell expansion (e.g., ${ANTHROPIC_API_KEY}) in Bash tool commands.
 *
 * The parent claude process keeps these vars (needed for API calls, lazy
 * credential reads). Only child processes (bash, shell snapshot, MCP stdio, LSP, hooks) are scrubbed.
 *
 * GITHUB_TOKEN / GH_TOKEN are intentionally NOT scrubbed — wrapper scripts
 * (gh.sh) need them to call the GitHub API. That token is job-scoped and
 * expires when the workflow ends.
 */
const GHA_SUBPROCESS_SCRUB = [
  // Anthropic auth — claude re-reads these per-request, subprocesses don't need them
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_CUSTOM_HEADERS',

  // OTLP exporter headers — documented to carry Authorization=Bearer tokens
  // for monitoring backends; read in-process by OTEL SDK, subprocesses never need them
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
  'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
  'OTEL_EXPORTER_OTLP_TRACES_HEADERS',

  // Cloud provider creds — same pattern (lazy SDK reads)
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'AZURE_CLIENT_SECRET',
  'AZURE_CLIENT_CERTIFICATE_PATH',

  // GitHub Actions OIDC — consumed by the action's JS before claude spawns;
  // leaking these allows minting an App installation token → repo takeover
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',

  // GitHub Actions artifact/cache API — cache poisoning → supply-chain pivot
  'ACTIONS_RUNTIME_TOKEN',
  'ACTIONS_RUNTIME_URL',

  // claude-code-action-specific duplicates — action JS consumes these during
  // prepare, before spawning claude. ALL_INPUTS contains anthropic_api_key as JSON.
  'ALL_INPUTS',
  'OVERRIDE_GITHUB_TOKEN',
  'DEFAULT_WORKFLOW_TOKEN',
  'SSH_SIGNING_KEY',
] as const

/**
 * Returns a copy of process.env with sensitive secrets stripped, for use when
 * spawning subprocesses (Bash tool, shell snapshot, MCP stdio servers, LSP
 * servers, shell hooks).
 *
 * Gated on CLAUDE_CODE_SUBPROCESS_ENV_SCRUB. claude-code-action sets this
 * automatically when `allowed_non_write_users` is configured — the flag that
 * exposes a workflow to untrusted content (prompt injection surface).
 */
// Registered by init.ts after the upstreamproxy module is dynamically imported
// in CCR sessions. Stays undefined in non-CCR startups so we never pull in the
// upstreamproxy module graph (upstreamproxy.ts + relay.ts) via a static import.
let _getUpstreamProxyEnv: (() => Record<string, string>) | undefined

/**
 * Called from init.ts to wire up the proxy env function after the upstreamproxy
 * module has been lazily loaded. Must be called before any subprocess is spawned.
 */
export function registerUpstreamProxyEnvFn(fn: () => Record<string, string>): void {
  _getUpstreamProxyEnv = fn
}

/**
 * CCR upstreamproxy: inject HTTPS_PROXY + CA bundle vars so curl/gh/python in
 * agent subprocesses route through the local relay. Returns {} when the proxy
 * is disabled or not registered (non-CCR), so this is a no-op outside CCR
 * containers.
 */
export function upstreamProxyEnv(): Record<string, string> {
  return _getUpstreamProxyEnv?.() ?? {}
}

/**
 * Decide whether subprocess env should be scrubbed. Explicit
 * CLAUDE_CODE_SUBPROCESS_ENV_SCRUB wins; when unset, scrub under the
 * local-agent entrypoint (an inherently untrusted content surface).
 */
function shouldScrubSubprocessEnv(): boolean {
  const scrub = process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB
  if (isEnvTruthy(scrub)) return true
  if (isEnvDefinedFalsy(scrub)) return false
  return process.env.CLAUDE_CODE_ENTRYPOINT === 'local-agent'
}

/**
 * Whether MCP stdio servers should receive an allowlisted env (the MCP SDK's
 * default inherited vars plus the upstream proxy) instead of the full scrubbed
 * process env. Follows the same gate shape as the scrub decision.
 */
export function shouldUseMcpAllowlistEnv(): boolean {
  const allowlist = process.env.CLAUDE_CODE_MCP_ALLOWLIST_ENV
  if (isEnvTruthy(allowlist)) return true
  if (isEnvDefinedFalsy(allowlist)) return false
  return process.env.CLAUDE_CODE_ENTRYPOINT === 'local-agent'
}

// CLAUDE_CODE_SCRIPT_CAPS: JSON object mapping a substring to the maximum number
// of times across the session that Bash commands may contain it. Only enforced
// when subprocess env scrubbing is on (the same untrusted-content gate), and it
// pairs with subprocess isolation to stop data exfiltration via repeated writes.
let scriptCaps: Record<string, number> | null | undefined
const scriptCapCounts = new Map<string, number>()

function parseScriptCaps(): Record<string, number> | null {
  if (scriptCaps !== undefined) return scriptCaps
  const raw = process.env.CLAUDE_CODE_SCRIPT_CAPS
  if (!raw) {
    scriptCaps = null
    return scriptCaps
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const filtered: Record<string, number> = {}
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'number' && Number.isFinite(value) && key.trim().length > 0) {
          filtered[key] = value
        }
      }
      scriptCaps = Object.keys(filtered).length > 0 ? filtered : null
    } else {
      scriptCaps = null
    }
  } catch {
    scriptCaps = null
  }
  return scriptCaps
}

/**
 * Enforce CLAUDE_CODE_SCRIPT_CAPS against a Bash command about to run. No-op
 * unless subprocess env scrubbing is enabled and caps are configured. Throws
 * when a substring's cumulative occurrence count exceeds its cap.
 */
export function enforceScriptCaps(command: string): void {
  if (!shouldScrubSubprocessEnv()) return
  const caps = parseScriptCaps()
  if (!caps) return
  for (const [pattern, cap] of Object.entries(caps)) {
    const occurrences = command.split(pattern).length - 1
    if (occurrences > 0) {
      const total = (scriptCapCounts.get(pattern) ?? 0) + occurrences
      scriptCapCounts.set(pattern, total)
      if (total > cap) {
        throw new Error(
          `Script call limit exceeded: ${pattern} has been called ${total} times (cap: ${cap}). This limit prevents data exfiltration via repeated write operations in untrusted-input workflows.`,
        )
      }
    }
  }
}

export function _resetScriptCapsForTesting(): void {
  scriptCapCounts.clear()
  scriptCaps = undefined
}

export function subprocessEnv(): NodeJS.ProcessEnv {
  const proxyEnv = upstreamProxyEnv()

  if (!shouldScrubSubprocessEnv()) {
    return Object.keys(proxyEnv).length > 0 ? { ...process.env, ...proxyEnv } : process.env
  }
  const env = { ...process.env, ...proxyEnv }
  for (const k of GHA_SUBPROCESS_SCRUB) {
    delete env[k]
    // GitHub Actions auto-creates INPUT_<NAME> for `with:` inputs, duplicating
    // secrets like INPUT_ANTHROPIC_API_KEY. No-op for vars that aren't action inputs.
    delete env[`INPUT_${k}`]
  }
  return env
}
