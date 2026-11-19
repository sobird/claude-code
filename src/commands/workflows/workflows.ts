/**
 * /workflows — list the declarative workflows defined under
 * `<cwd>/.claude/workflows`. Each definition also gets its own
 * `/workflow-<slug>` command via getWorkflowCommands().
 */

import { getOriginalCwd } from '../../bootstrap/state.js'
import {
  getWorkflowDir,
  loadWorkflowDefinitions,
  type WorkflowDefinition,
} from '../../tools/WorkflowTool/definitions.js'
import type { LocalCommandCall } from '../../types/command.js'

/** Renders the workflow table plus the invocation hint. */
export function formatWorkflowTable(definitions: WorkflowDefinition[], cwd: string): string {
  const dir = getWorkflowDir(cwd)
  if (definitions.length === 0) {
    return `No workflows found in ${dir}. Define one as a YAML or JSON file with a steps list.`
  }

  const header = ['NAME', 'STEPS', 'DESCRIPTION']
  const rows = definitions.map((definition) => [
    definition.name,
    String(definition.steps.length),
    definition.description ?? '-',
  ])

  const widths = header.map((cell, column) => Math.max(cell.length, ...rows.map((row) => row[column].length)))
  const render = (row: string[]): string =>
    row
      .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column])))
      .join('  ')
      .trimEnd()

  return [
    render(header),
    ...rows.map(render),
    '',
    `Run one with /workflow-<slug> (arguments are passed through). Definitions live in ${dir}.`,
  ].join('\n')
}

export async function formatWorkflowList(cwd: string): Promise<string> {
  return formatWorkflowTable(await loadWorkflowDefinitions(cwd), cwd)
}

export const call: LocalCommandCall = async () => {
  return { type: 'text', value: await formatWorkflowList(getOriginalCwd()) }
}
