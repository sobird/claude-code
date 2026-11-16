/**
 * Thin logging wrapper — silent under `bun test`, console in production.
 *
 * Kept dependency-free so both the gateway routes and the Bun entry can import it without
 * pulling in a logging framework.
 */

const isTest = process.env.NODE_ENV === 'test' || (typeof Bun !== 'undefined' && !!Bun.env.BUN_TEST)

export function log(...args: unknown[]): void {
  if (!isTest) console.log(...args)
}

export function error(...args: unknown[]): void {
  if (!isTest) console.error(...args)
}
