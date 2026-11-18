/**
 * COMMIT_ATTRIBUTION tracking hooks (internal builds only).
 *
 * Registers internal Pre/PostToolUse callbacks that record how much of each
 * file's content Claude contributed:
 *
 * - Edit/Write: PreToolUse caches the pre-edit content; PostToolUse diffs it
 *   against the new on-disk content and feeds the result into attribution
 *   state.
 * - Bash: PreToolUse snapshots `git status --porcelain`; PostToolUse diffs the
 *   snapshot to find files the command touched, reconstructing old content via
 *   `git show HEAD:<path>`.
 *
 * All caching is bounded: the file-content cache is capped and swept on
 * compaction / `/clear`, and the Bash path only considers a limited number of
 * changed files per command.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { registerHookCallbacks } from '../bootstrap/state.js'
import type { HookInput, HookJSONOutput } from '../entrypoints/agentSdkTypes.js'
import { BASH_TOOL_NAME } from '../tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '../tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '../tools/FileWriteTool/prompt.js'
import type { HookCallback, HookCallbackContext } from '../types/hooks.js'
import {
  type AttributionState,
  expandFilePath,
  getAttributionRepoRoot,
  getFileMtime,
  trackBulkFileChanges,
  trackFileCreation,
  trackFileDeletion,
  trackFileModification,
} from './commitAttribution.js'
import { logForDebugging } from './debug.js'
import { errorMessage } from './errors.js'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'

/** Bound the cache so a long session editing thousands of files can't grow it
 *  without limit. Oldest (insertion-ordered) entries are evicted first. */
const MAX_CACHED_FILES = 500
/** Entries unused for this long are dropped on sweep. */
const CACHE_TTL_MS = 10 * 60_000
/** Per-command cap on files attributed through the Bash path. */
const MAX_BASH_CHANGES = 500

type CachedContent = {
  /** Pre-edit content, or null when the file did not exist. */
  content: string | null
  cachedAt: number
}

const fileContentCache = new Map<string, CachedContent>()
/** toolUseID → `git status --porcelain` snapshot taken before the command ran. */
const pendingBashStates = new Map<string, string>()

function cacheFileContent(absolutePath: string, content: string | null): void {
  fileContentCache.delete(absolutePath)
  fileContentCache.set(absolutePath, { content, cachedAt: Date.now() })
  while (fileContentCache.size > MAX_CACHED_FILES) {
    const oldest = fileContentCache.keys().next().value
    if (oldest === undefined) break
    fileContentCache.delete(oldest)
  }
}

/** Drop cached file contents older than the TTL. Called after compaction. */
export function sweepFileContentCache(): void {
  const cutoff = Date.now() - CACHE_TTL_MS
  for (const [path, entry] of fileContentCache) {
    if (entry.cachedAt < cutoff) {
      fileContentCache.delete(path)
    }
  }
}

/** Full reset — `/clear` starts a new session's attribution from scratch. */
export function clearAttributionCaches(): void {
  fileContentCache.clear()
  pendingBashStates.clear()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getToolName(input: HookInput): string {
  return typeof input.tool_name === 'string' ? input.tool_name : ''
}

function getFilePath(toolInput: unknown): string | null {
  if (!isRecord(toolInput)) return null
  return typeof toolInput.file_path === 'string' ? toolInput.file_path : null
}

/** Read a text file, treating binary (NUL-containing) and missing files as null. */
async function readTextFile(absolutePath: string): Promise<string | null> {
  try {
    const content = await readFile(absolutePath, 'utf8')
    return content.includes('\u0000') ? null : content
  } catch {
    return null
  }
}

async function readGitStatus(): Promise<string | null> {
  const result = await execFileNoThrowWithCwd('git', ['status', '--porcelain'], {
    cwd: getAttributionRepoRoot(),
  })
  return result.code === 0 ? result.stdout : null
}

async function gitShowHead(repoRoot: string, path: string): Promise<string | null> {
  const result = await execFileNoThrowWithCwd('git', ['show', `HEAD:${path}`], { cwd: repoRoot })
  return result.code === 0 ? result.stdout : null
}

async function handlePre(input: HookInput, toolUseID: string | null): Promise<void> {
  const toolName = getToolName(input)
  if (toolName === FILE_EDIT_TOOL_NAME || toolName === FILE_WRITE_TOOL_NAME) {
    const filePath = getFilePath(input.tool_input)
    if (filePath === null) return
    const absolute = expandFilePath(filePath)
    cacheFileContent(absolute, await readTextFile(absolute))
    return
  }

  if (toolName === BASH_TOOL_NAME && toolUseID !== null) {
    const snapshot = await readGitStatus()
    if (snapshot !== null) {
      pendingBashStates.set(toolUseID, snapshot)
    }
  }
}

async function updateForFileWrite(
  input: HookInput,
  context: HookCallbackContext,
  update: (updater: (prev: AttributionState) => AttributionState) => void,
): Promise<void> {
  const filePath = getFilePath(input.tool_input)
  if (filePath === null) return
  const absolute = expandFilePath(filePath)
  const cached = fileContentCache.get(absolute)
  fileContentCache.delete(absolute)
  // No pre-edit snapshot: an Edit's diff is unknowable, so don't guess. Write
  // replaces the whole file, so treating a missing snapshot as "empty" is
  // still an honest attribution of the write.
  if (cached === undefined && getToolName(input) === FILE_EDIT_TOOL_NAME) {
    return
  }

  const newContent = await readTextFile(absolute)
  if (newContent === null) {
    // The tool removed the file (rare) — attribute the deletion instead.
    const oldContent = cached?.content
    if (oldContent != null) {
      update((prev) => trackFileDeletion(prev, absolute, oldContent))
    }
    return
  }

  const oldContent = cached?.content ?? null
  if (oldContent === newContent) return
  const mtime = await getFileMtime(absolute)

  update((prev) =>
    oldContent === null
      ? trackFileCreation(prev, absolute, newContent, mtime)
      : trackFileModification(prev, absolute, oldContent, newContent, false, mtime),
  )
  void context // attribution is written through `update`; context kept for parity
}

type PorcelainChange = {
  path: string
  status: 'created' | 'modified' | 'deleted'
}

function parsePorcelainLine(line: string): PorcelainChange | null {
  if (line.length < 4) return null
  const code = line.slice(0, 2)
  let path = line.slice(3)
  // Quoted paths use C-style escaping; parsing them correctly is not worth the
  // complexity for an approximation — skip rather than misattribute.
  if (path.startsWith('"')) return null
  if (path.includes(' -> ')) {
    path = path.split(' -> ').pop() ?? path
  }
  if (code === '??' || code.includes('A')) return { path, status: 'created' }
  if (code.includes('D')) return { path, status: 'deleted' }
  return { path, status: 'modified' }
}

type BulkChange = {
  path: string
  type: 'modified' | 'created' | 'deleted'
  oldContent: string
  newContent: string
  mtime?: number
}

async function updateForBash(
  toolUseID: string,
  update: (updater: (prev: AttributionState) => AttributionState) => void,
): Promise<void> {
  const before = pendingBashStates.get(toolUseID)
  pendingBashStates.delete(toolUseID)
  if (before === undefined) return

  const after = await readGitStatus()
  if (after === null || after === before) return

  const beforeLines = new Set(before.split('\n'))
  const repoRoot = getAttributionRepoRoot()
  const changes: BulkChange[] = []

  for (const line of after.split('\n')) {
    if (line.length === 0 || beforeLines.has(line)) continue
    const parsed = parsePorcelainLine(line)
    if (parsed === null) continue

    const absolute = join(repoRoot, parsed.path)
    if (parsed.status === 'deleted') {
      changes.push({
        path: absolute,
        type: 'deleted',
        oldContent: (await gitShowHead(repoRoot, parsed.path)) ?? '',
        newContent: '',
      })
    } else {
      changes.push({
        path: absolute,
        type: parsed.status,
        oldContent: (await gitShowHead(repoRoot, parsed.path)) ?? '',
        newContent: (await readTextFile(absolute)) ?? '',
      })
    }

    if (changes.length >= MAX_BASH_CHANGES) {
      logForDebugging(`[attribution] capping bash attribution at ${MAX_BASH_CHANGES} files`)
      break
    }
  }

  if (changes.length > 0) {
    update((prev) => trackBulkFileChanges(prev, changes))
  }
}

async function handleAttributionHook(
  input: HookInput,
  toolUseID: string | null,
  _abort: AbortSignal | undefined,
  _hookIndex: number | undefined,
  context: HookCallbackContext | undefined,
): Promise<HookJSONOutput> {
  if (context === undefined) {
    return {}
  }

  try {
    const update = context.updateAttributionState
    switch (input.hook_event_name) {
      case 'PreToolUse':
        await handlePre(input, toolUseID)
        break
      case 'PostToolUse':
        if (getToolName(input) === BASH_TOOL_NAME) {
          if (toolUseID !== null) await updateForBash(toolUseID, update)
        } else {
          await updateForFileWrite(input, context, update)
        }
        break
    }
  } catch (error) {
    // Attribution is best-effort telemetry; never fail the tool call over it.
    logForDebugging(`[attribution] hook failed: ${errorMessage(error)}`)
  }

  return {}
}

/**
 * Register the attribution hooks and install the prepare-commit-msg hook into
 * the current repo. Called once during setup behind feature('COMMIT_ATTRIBUTION').
 */
export function registerAttributionHooks(): void {
  const hook: HookCallback = {
    type: 'callback',
    callback: handleAttributionHook,
    // Git/disk I/O per tool call; generous enough for large diffs.
    timeout: 30,
    internal: true,
  }

  registerHookCallbacks({
    PreToolUse: [
      { matcher: FILE_EDIT_TOOL_NAME, hooks: [hook] },
      { matcher: FILE_WRITE_TOOL_NAME, hooks: [hook] },
      { matcher: BASH_TOOL_NAME, hooks: [hook] },
    ],
    PostToolUse: [
      { matcher: FILE_EDIT_TOOL_NAME, hooks: [hook] },
      { matcher: FILE_WRITE_TOOL_NAME, hooks: [hook] },
      { matcher: BASH_TOOL_NAME, hooks: [hook] },
    ],
  })

  // Fire-and-forget: a failed install only costs squash-merge trailers.
  void import('./postCommitAttribution.js')
    .then((module) => module.installPrepareCommitMsgHook(getAttributionRepoRoot()))
    .catch((error: unknown) => {
      logForDebugging(`[attribution] prepare-commit-msg install failed: ${errorMessage(error)}`)
    })
}
