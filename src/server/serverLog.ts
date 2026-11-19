import { logForDebugging } from '../utils/debug.js'

export type ServerLogLevel = 'info' | 'warn' | 'error' | 'debug'

export interface ServerLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
  debug(message: string): void
}

function format(level: ServerLogLevel, message: string): string {
  return `[server ${new Date().toISOString()}] ${level.toUpperCase()} ${message}`
}

function write(level: ServerLogLevel, message: string): void {
  const line = format(level, message)
  if (level === 'debug') {
    logForDebugging(line)
    return
  }
  process.stderr.write(`${line}\n`)
}

/**
 * Creates the logger handed to `startServer`. Info/warn/error go to stderr so
 * they never collide with the interactive TUI on stdout; debug routes through
 * the standard debug channel so it obeys the same gating as the rest of the CLI.
 */
export function createServerLogger(): ServerLogger {
  return {
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
    debug: (message) => write('debug', message),
  }
}
