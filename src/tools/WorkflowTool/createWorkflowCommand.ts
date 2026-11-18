/**
 * Workflow-backed slash commands.
 *
 * `commands.ts` calls `getWorkflowCommands(cwd)` (feature('WORKFLOW_SCRIPTS'))
 * and spreads the result into the command list. One prompt command is created
 * per workflow definition, named `workflow-<slug>`; invoking it expands a
 * prompt telling the model to run that workflow through the Workflow tool with
 * the user's arguments. Command names are slugified because workflow names are
 * free-form and may contain spaces or punctuation.
 */

import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'

import type { Command } from '../../types/command.js'
import { loadWorkflowDefinitions, resolveStepAction, type WorkflowDefinition } from './definitions.js'

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'workflow'
}

function buildPrompt(definition: WorkflowDefinition, args: string): string {
  const steps = definition.steps
    .map((step, i) => `${i + 1}. ${step.name ?? `Step ${i + 1}`} [${resolveStepAction(step)}]`)
    .join('\n')
  return `<workflow name="${definition.name}">
${definition.description ? `${definition.description}\n\n` : ''}Run this workflow with the Workflow tool. Call it with:
{"action":"run","name":"${definition.name}"${args.trim() ? `,"args":${JSON.stringify(args.trim().split(/\s+/))}` : ''}}

Steps (in order):
${steps}
${args.trim() ? `\nUser arguments: ${args.trim()}` : ''}
</workflow>`
}

export async function getWorkflowCommands(cwd: string): Promise<Command[]> {
  const definitions = await loadWorkflowDefinitions(cwd)
  return definitions.map((definition) => {
    const basePrompt = buildPrompt(definition, '')
    return {
      type: 'prompt',
      name: `workflow-${slugify(definition.name)}`,
      description: definition.description ?? `Run the "${definition.name}" workflow`,
      progressMessage: `Running workflow ${definition.name}…`,
      contentLength: basePrompt.length,
      source: 'bundled',
      loadedFrom: 'bundled',
      kind: 'workflow',
      userInvocable: true,
      async getPromptForCommand(args: string): Promise<ContentBlockParam[]> {
        return [{ type: 'text', text: buildPrompt(definition, args) }]
      },
    }
  })
}
