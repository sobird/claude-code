/**
 * Workflow — list, describe, and run declarative workflows.
 *
 * Definitions live in `<cwd>/.claude/workflows/*.{yaml,yml,json}` and are
 * loaded by `definitions.ts`. A run executes steps in declaration order:
 * `shell` under `bash -c`, `write_file` relative to the working directory, and
 * `agent` as a forked agent turn sharing the parent's prompt cache. Agent steps
 * receive the same `canUseTool` the tool itself was called with, so they are
 * subject to the normal permission pipeline rather than bypassing it.
 *
 * Approximation: the upstream design hands the run to `LocalWorkflowTask`, a
 * background task with per-step retry/skip/stop controls. That task type exists
 * here only as a stub with no spawn helper, so this tool runs steps inline and
 * reports them in the tool result. Runs are therefore bounded by the tool call
 * and cannot be paused from the task dialog.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'

import { z } from 'zod/v4'

import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { extractResultText, getLastCacheSafeParams, runForkedAgent } from '../../utils/forkedAgent.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { createUserMessage } from '../../utils/messages.js'
import { WORKFLOW_TOOL_NAME } from './constants.js'
import {
  applyWorkflowTemplates,
  loadWorkflowDefinition,
  loadWorkflowDefinitions,
  resolveStepAction,
  type WorkflowDefinition,
} from './definitions.js'

const MAX_AGENT_TURNS = 30

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['list', 'describe', 'run']).describe('Operation to perform.'),
    name: z.string().optional().describe('Workflow name (required for describe and run).'),
    args: z.array(z.string()).optional().describe('Arguments substituted for {{args}} / {{args.N}}.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    action: z.string(),
    workflows: z.array(z.string()).optional(),
    workflow: z
      .object({
        name: z.string(),
        description: z.string().optional(),
        version: z.string().optional(),
        path: z.string(),
        steps: z.array(z.string()),
      })
      .optional(),
    success: z.boolean().optional(),
    results: z
      .array(
        z.object({
          name: z.string(),
          action: z.string(),
          success: z.boolean(),
          output: z.string(),
        }),
      )
      .optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

function describeStep(definition: WorkflowDefinition, index: number): string {
  const step = definition.steps[index]
  const name = step.name ?? `Step ${index + 1}`
  return `${name} [${resolveStepAction(step)}]`
}

export const WorkflowTool = buildTool({
  name: WORKFLOW_TOOL_NAME,
  searchHint: 'list and run declared workflows',
  maxResultSizeChars: 100_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    // Loaded only under feature('WORKFLOW_SCRIPTS').
    return true
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly(input) {
    return input?.action !== 'run'
  },
  async checkPermissions(input) {
    if (input.action !== 'run') {
      return { behavior: 'allow' as const, updatedInput: input }
    }
    return {
      behavior: 'ask' as const,
      message: `Run workflow ${input.name ?? '(unnamed)'}?`,
      updatedInput: input,
    }
  },
  toAutoClassifierInput(input) {
    return `Workflow ${input.action}${input.name ? ` ${input.name}` : ''}`
  },
  renderToolUseMessage(input) {
    return `Workflow ${input.action}${input.name ? ` "${input.name}"` : ''}`
  },
  async description() {
    return 'List, describe, and run workflows defined under .claude/workflows.'
  },
  async prompt() {
    return 'Work inside the workflows the user has defined in .claude/workflows. Use "list" to discover them, "describe" to see the steps of one, and "run" to execute it. Steps run in order: shell steps use bash, write_file steps write relative to the project root, and agent steps get their own model turn. Use workflows when the user has already encoded a repeatable process; otherwise do the work directly.'
  },
  async call(input, _context, canUseTool) {
    const cwd = getCwd()

    if (input.action === 'list') {
      const definitions = await loadWorkflowDefinitions(cwd)
      return { data: { action: input.action, workflows: definitions.map((d) => d.name) } }
    }

    if (!input.name) {
      throw new Error(`The ${input.action} action requires a "name".`)
    }
    const definition = await loadWorkflowDefinition(cwd, input.name)
    if (!definition) {
      const available = (await loadWorkflowDefinitions(cwd)).map((d) => d.name)
      throw new Error(
        available.length > 0
          ? `No workflow named "${input.name}". Available: ${available.join(', ')}.`
          : `No workflows found in ${cwd}/.claude/workflows.`,
      )
    }

    if (input.action === 'describe') {
      return {
        data: {
          action: input.action,
          workflow: {
            name: definition.name,
            description: definition.description,
            version: definition.version,
            path: definition.path,
            steps: definition.steps.map((_, i) => describeStep(definition, i)),
          },
        },
      }
    }

    const args = input.args ?? []
    const results: string[] = []
    const stepResults: NonNullable<Output['results']> = []
    let success = true

    for (let i = 0; i < definition.steps.length; i++) {
      const step = definition.steps[i]
      const name = step.name ?? `Step ${i + 1}`
      const action = resolveStepAction(step)
      const expand = (text: string | undefined) =>
        text === undefined ? undefined : applyWorkflowTemplates(text, results, args)

      let output = ''
      let ok = false
      try {
        if (action === 'shell') {
          const command = expand(step.command)
          if (!command) throw new Error('shell step has no command')
          const result = await execFileNoThrow('bash', ['-c', command], {
            useCwd: true,
            timeout: step.timeout ? step.timeout * 1000 : undefined,
          })
          output = [result.stdout, result.stderr]
            .filter((s) => s && s.length > 0)
            .join('\n')
            .trim()
          ok = result.code === 0
          if (!ok && !output) output = `shell exited with code ${result.code}`
        } else if (action === 'write_file') {
          const target = expand(step.path)
          if (!target) throw new Error('write_file step has no path')
          const absolute = isAbsolute(target) ? target : resolve(cwd, target)
          await mkdir(dirname(absolute), { recursive: true })
          await writeFile(absolute, expand(step.content) ?? '', 'utf8')
          output = `Wrote ${absolute}`
          ok = true
        } else {
          const prompt = expand(step.prompt)
          if (!prompt) throw new Error('agent step has no prompt')
          const cacheSafeParams = getLastCacheSafeParams()
          if (!cacheSafeParams) {
            throw new Error('agent steps need an active model session to share prompt cache parameters')
          }
          const result = await runForkedAgent({
            promptMessages: [createUserMessage({ content: prompt })],
            cacheSafeParams,
            canUseTool,
            querySource: 'agent:builtin:workflow',
            forkLabel: 'workflow_step',
            maxTurns: MAX_AGENT_TURNS,
            skipCacheWrite: true,
          })
          output = extractResultText(result.messages, 'No output.')
          ok = true
        }
      } catch (e) {
        output = e instanceof Error ? e.message : String(e)
        ok = false
      }

      results.push(output)
      stepResults.push({ name, action, success: ok, output })
      if (!ok) {
        success = false
        break
      }
    }

    return {
      data: {
        action: input.action,
        workflow: {
          name: definition.name,
          description: definition.description,
          version: definition.version,
          path: definition.path,
          steps: definition.steps.map((_, i) => describeStep(definition, i)),
        },
        success,
        results: stepResults,
      },
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (output.workflows) {
      const content =
        output.workflows.length > 0 ? `Workflows: ${output.workflows.join(', ')}` : 'No workflows defined.'
      return { type: 'tool_result', tool_use_id: toolUseID, content }
    }
    if (!output.results) {
      const wf = output.workflow
      if (!wf) return { type: 'tool_result', tool_use_id: toolUseID, content: 'No workflow information.' }
      const lines = [`${wf.name}${wf.version ? ` v${wf.version}` : ''} — ${wf.path}`]
      if (wf.description) lines.push(wf.description)
      lines.push('', ...wf.steps.map((s, i) => `${i + 1}. ${s}`))
      return { type: 'tool_result', tool_use_id: toolUseID, content: lines.join('\n') }
    }
    const lines = [
      `Workflow ${output.workflow?.name ?? ''} ${output.success ? 'succeeded' : 'failed'}.`,
      ...output.results.map((r) => `- ${r.name} [${r.action}] ${r.success ? 'ok' : 'FAILED'}: ${r.output}`),
    ]
    return { type: 'tool_result', tool_use_id: toolUseID, content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)
