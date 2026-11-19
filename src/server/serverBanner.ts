import chalk from 'chalk'

export interface ServerBannerConfig {
  port: number
  host: string
  authToken: string
  unix?: string
  workspace?: string
  idleTimeoutMs: number
  maxSessions: number
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'disabled'
  const minutes = Math.round(ms / 60_000)
  return `${minutes}m`
}

/**
 * Prints the one-time startup banner for `claude server` — endpoint, auth
 * token, and session limits — to stderr so it never mixes with a REPL on
 * stdout.
 */
export function printBanner(config: ServerBannerConfig, authToken: string, actualPort: number): void {
  const endpoint = config.unix ? `unix:${config.unix}` : `http://${config.host}:${actualPort}`
  const lines = [
    '',
    chalk.bold('Claude Code server'),
    `  ${chalk.dim('endpoint')}      ${endpoint}`,
    `  ${chalk.dim('auth token')}    ${authToken}`,
    ...(config.workspace ? [`  ${chalk.dim('workspace')}    ${config.workspace}`] : []),
    `  ${chalk.dim('idle timeout')}  ${formatDuration(config.idleTimeoutMs)}`,
    `  ${chalk.dim('max sessions')}  ${config.maxSessions}`,
    '',
    chalk.dim(`Connect with: claude "cc://${config.host}:${actualPort}?token=${authToken}"`),
    '',
  ]
  process.stderr.write(`${lines.join('\n')}\n`)
}
