/**
 * Workflow definition loading and templating.
 *
 * Workflows are declarative YAML/JSON files under `.claude/workflows/`
 * (project-scoped, alongside the other `.claude/` configuration). A definition
 * has a name, optional description/version, and an ordered list of steps. Each
 * step is one of:
 *
 *   - shell:      { command, timeout? }        — run under `bash -c`
 *   - write_file: { path, content }            — write a file relative to cwd
 *   - agent:      { prompt, timeout? }         — forked agent turn
 *
 * Field names follow docs/features/WORKFLOW_SCRIPTS.md (`action`, `command`,
 * `path`, `content`, `prompt`, `depends_on`). `depends_on` is accepted but not
 * used for ordering: steps execute in declaration order, which is the order the
 * file lists them in. Templates `{{step_N.result}}` and `{{args}}` are expanded
 * before each step runs.
 */

import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import { parse as parseYaml } from 'yaml'

import { logForDebugging } from '../../utils/debug.js'
import { getErrnoCode } from '../../utils/errors.js'

export type WorkflowStepAction = 'agent' | 'shell' | 'write_file'

export type WorkflowStep = {
  name?: string
  /** Canonical field; `type` is accepted as a fallback for older files. */
  action?: string
  type?: string
  prompt?: string
  command?: string
  path?: string
  content?: string
  /** Timeout in seconds for shell/agent steps. */
  timeout?: number
  depends_on?: string[]
}

export type WorkflowDefinition = {
  name: string
  description?: string
  version?: string
  steps: WorkflowStep[]
  /** Absolute path the definition was loaded from. */
  path: string
}

export function getWorkflowDir(cwd: string): string {
  return join(cwd, '.claude', 'workflows')
}

function isWorkflowFile(file: string): boolean {
  const ext = extname(file).toLowerCase()
  return ext === '.yaml' || ext === '.yml' || ext === '.json'
}

function normalizeStep(raw: unknown): WorkflowStep | null {
  if (!raw || typeof raw !== 'object') return null
  const step = raw as Record<string, unknown>
  const normalized: WorkflowStep = {}
  if (typeof step.name === 'string') normalized.name = step.name
  if (typeof step.action === 'string') normalized.action = step.action
  if (typeof step.type === 'string') normalized.type = step.type
  if (typeof step.prompt === 'string') normalized.prompt = step.prompt
  if (typeof step.command === 'string') normalized.command = step.command
  if (typeof step.path === 'string') normalized.path = step.path
  if (typeof step.content === 'string') normalized.content = step.content
  if (typeof step.timeout === 'number') normalized.timeout = step.timeout
  if (Array.isArray(step.depends_on)) {
    normalized.depends_on = step.depends_on.filter((v): v is string => typeof v === 'string')
  }
  return normalized
}

async function parseWorkflowFile(path: string): Promise<WorkflowDefinition | null> {
  const raw = await readFile(path, 'utf8')
  const ext = extname(path).toLowerCase()
  let data: unknown
  try {
    data = ext === '.json' ? JSON.parse(raw) : parseYaml(raw)
  } catch (e) {
    logForDebugging(`[Workflow] Failed to parse ${path}: ${(e as Error).message}`)
    return null
  }
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  if (!Array.isArray(record.steps)) {
    logForDebugging(`[Workflow] ${path} has no steps array; skipping.`)
    return null
  }
  const steps = record.steps.map(normalizeStep).filter((step): step is WorkflowStep => step !== null)
  if (steps.length === 0) return null
  const fallbackName = basename(path, ext)
  const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : fallbackName
  return {
    name,
    description: typeof record.description === 'string' ? record.description : undefined,
    version: typeof record.version === 'string' ? record.version : undefined,
    steps,
    path,
  }
}

/** Load every workflow definition in `<cwd>/.claude/workflows`, sorted by name. */
export async function loadWorkflowDefinitions(cwd: string): Promise<WorkflowDefinition[]> {
  const dir = getWorkflowDir(cwd)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (e) {
    if (getErrnoCode(e) === 'ENOENT') return []
    throw e
  }
  const parsed = await Promise.all(
    entries.filter(isWorkflowFile).map((file) => parseWorkflowFile(join(dir, file)).catch(() => null)),
  )
  const definitions: WorkflowDefinition[] = []
  const seen = new Set<string>()
  for (const definition of parsed) {
    if (!definition || seen.has(definition.name)) continue
    seen.add(definition.name)
    definitions.push(definition)
  }
  return definitions.toSorted((a, b) => a.name.localeCompare(b.name))
}

export async function loadWorkflowDefinition(cwd: string, name: string): Promise<WorkflowDefinition | undefined> {
  const definitions = await loadWorkflowDefinitions(cwd)
  return (
    definitions.find((d) => d.name === name) ?? definitions.find((d) => d.name.toLowerCase() === name.toLowerCase())
  )
}

/**
 * Expand `{{step_N.result}}`, `{{steps.N.output}}`, `{{args}}`, and
 * `{{args.N}}` in a step's command/content/prompt.
 */
export function applyWorkflowTemplates(text: string, results: string[], args: string[]): string {
  return text
    .replace(/\{\{\s*step_(\d+)\.result\s*\}\}/g, (_match, n: string) => results[Number(n) - 1] ?? '')
    .replace(/\{\{\s*steps\.(\d+)\.output\s*\}\}/g, (_match, n: string) => results[Number(n) - 1] ?? '')
    .replace(/\{\{\s*args\.(\d+)\s*\}\}/g, (_match, n: string) => args[Number(n) - 1] ?? '')
    .replace(/\{\{\s*args\s*\}\}/g, args.join(' '))
}

/** Resolve the action for a step, falling back to whichever field is present. */
export function resolveStepAction(step: WorkflowStep): WorkflowStepAction {
  const declared = step.action ?? step.type
  if (declared === 'agent' || declared === 'shell' || declared === 'write_file') return declared
  if (step.prompt !== undefined) return 'agent'
  if (step.path !== undefined) return 'write_file'
  return 'shell'
}
