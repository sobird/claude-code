import { AsyncLocalStorage } from 'node:async_hooks'

import { getCwdState, getOriginalCwd, setCwdState } from '../bootstrap/state.js'

interface CwdOverride {
  cwd: string
}

const cwdOverrideStorage = new AsyncLocalStorage<CwdOverride>()

/**
 * Run a function with an overridden working directory for the current async context.
 * All calls to pwd()/getCwd() within the function (and its async descendants) will
 * return the overridden cwd instead of the global one. This enables concurrent
 * agents to each see their own working directory without affecting each other.
 */
export function runWithCwdOverride<T>(cwd: string, fn: () => T): T {
  return cwdOverrideStorage.run({ cwd: cwd.normalize('NFC') }, fn)
}

/**
 * Whether the current async context has an overridden working directory
 * (e.g. a subagent with worktree isolation or a `cwd:` override).
 */
export function isInCwdOverride(): boolean {
  return cwdOverrideStorage.getStore() !== undefined
}

/**
 * Set the working directory for the current async context, or the global state
 * when no override is active. A subagent's `cd` must stay local to its own
 * context instead of leaking back to the parent session's Bash tool
 * (upstream 2.1.98 #22).
 */
export function setCwdForCurrentContext(cwd: string): void {
  const store = cwdOverrideStorage.getStore()
  if (store) store.cwd = cwd.normalize('NFC')
  else setCwdState(cwd)
}

/**
 * Get the current working directory
 */
export function pwd(): string {
  return cwdOverrideStorage.getStore()?.cwd ?? getCwdState()
}

/**
 * Get the current working directory or the original working directory if the current one is not available
 */
export function getCwd(): string {
  try {
    return pwd()
  } catch {
    return getOriginalCwd()
  }
}
