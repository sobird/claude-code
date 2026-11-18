/**
 * SuggestBackgroundPR — summarize the working tree and propose a background PR.
 *
 * Ant-only. The upstream tool hands off to the remote "background-pr" task;
 * this tree has the task type registered (RemoteAgentTask) but no local spawn
 * helper exposed to tools, so this implementation gathers the evidence a
 * handoff needs — branch, changed files, diffstat — and returns a proposed
 * PR title plus the exact command to launch. It never pushes or opens a PR.
 */

import { z } from 'zod/v4'

import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { lazySchema } from '../../utils/lazySchema.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    focus: z.string().optional().describe('Optional angle for the PR description (e.g. "the auth rewrite").'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    branch: z.string(),
    changedFiles: z.array(z.string()),
    diffstat: z.string(),
    suggestedTitle: z.string(),
    suggestedCommand: z.string(),
    hasChanges: z.boolean(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

async function git(args: string[]): Promise<string> {
  const result = await execFileNoThrow('git', args)
  return result.code === 0 ? result.stdout.trim() : ''
}

export const SuggestBackgroundPRTool = buildTool({
  name: 'SuggestBackgroundPR',
  searchHint: 'suggest creating a pull request in the background',
  maxResultSizeChars: 20_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    // Ant-only in tools.ts; keep the gate explicit for direct imports.
    return process.env.USER_TYPE === 'ant'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput() {
    return ''
  },
  renderToolUseMessage() {
    return 'Suggest a background PR'
  },
  async description() {
    return 'Summarize the working tree and suggest a background pull request.'
  },
  async prompt() {
    return 'Inspect the current branch and uncommitted changes and propose a pull request that could be created in the background. Use it when the work looks complete enough to hand off. It does not push or open anything; it returns the branch, changed files, diffstat, a suggested title, and the command to launch the background PR task.'
  },
  async call(input: z.infer<InputSchema>) {
    const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])) || '(detached)'
    const status = await git(['status', '--porcelain'])
    const changedFiles = status
      .split('\n')
      .map((line) => line.slice(3).trim())
      .filter((path) => path.length > 0)
    const diffstat = await git(['diff', '--stat'])
    const hasChanges = changedFiles.length > 0

    const focus = input.focus?.trim()
    const suggestedTitle = focus
      ? `Background PR: ${focus}`
      : `Background PR for ${branch}${hasChanges ? ` (${changedFiles.length} files)` : ''}`
    const suggestedCommand = `claude --bg --pr "${suggestedTitle.replaceAll('"', '\\"')}"`

    return {
      data: {
        branch,
        changedFiles,
        diffstat,
        suggestedTitle,
        suggestedCommand,
        hasChanges,
      },
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const lines = [
      `Branch: ${output.branch} (cwd ${getCwd()})`,
      output.hasChanges
        ? `Changed files (${output.changedFiles.length}): ${output.changedFiles.slice(0, 40).join(', ')}`
        : 'No uncommitted changes detected.',
    ]
    if (output.diffstat) lines.push('', output.diffstat)
    lines.push('', `Suggested title: ${output.suggestedTitle}`, `Launch: ${output.suggestedCommand}`)
    return { type: 'tool_result', tool_use_id: toolUseID, content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)
