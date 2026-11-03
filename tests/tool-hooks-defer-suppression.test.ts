import { expect, mock, test } from 'bun:test'

import type { Tool, ToolUseContext } from '../src/Tool.js'
import * as realHooks from '../src/utils/hooks.js'

// Queue of aggregated hook results the stubbed executePreToolHooks will yield.
let hookResults: unknown[] = []

void mock.module('../src/utils/hooks.js', () => ({
  ...realHooks,
  executePreToolHooks: async function* () {
    for (const result of hookResults) yield result
  },
}))

// Imported after mock.module so runPreToolUseHooks binds the stub.
const { runPreToolUseHooks } = await import('../src/services/tools/toolHooks.js')

function makeContext(): ToolUseContext {
  return {
    getAppState: () => ({ toolPermissionContext: { mode: 'default' } }),
    abortController: new AbortController(),
    requestPrompt: undefined,
  } as unknown as ToolUseContext
}

const tool = { name: 'Bash', getToolUseSummary: () => undefined } as unknown as Tool

type Event = { type: string; hookPermissionResult?: { behavior: string }; hookName?: string }

async function collect(results: unknown[]): Promise<Event[]> {
  hookResults = results
  const yielded: Event[] = []
  for await (const event of runPreToolUseHooks(
    makeContext(),
    tool,
    {},
    'toolu_1',
    'msg_1',
    undefined,
    'none' as never,
    undefined,
  )) {
    yielded.push(event as Event)
  }
  return yielded
}

function permissionBehaviors(events: Event[]): string[] {
  return events.filter((e) => e.type === 'hookPermissionResult').map((e) => e.hookPermissionResult?.behavior ?? '')
}

test('a blockingError deny suppresses a sibling defer', async () => {
  const events = await collect([
    { blockingError: { blockingError: 'blocked by hook', command: 'deny.sh' }, outcome: 'blocking' },
    { permissionBehavior: 'defer', hookSource: 'defer-hook', outcome: 'success' },
  ])
  expect(permissionBehaviors(events)).toEqual(['deny'])
  expect(events.some((e) => e.type === 'defer')).toBe(false)
})

test('a defer alone surfaces a defer event', async () => {
  const events = await collect([{ permissionBehavior: 'defer', hookSource: 'defer-hook', outcome: 'success' }])
  const deferEvents = events.filter((e) => e.type === 'defer')
  expect(deferEvents).toHaveLength(1)
  expect(deferEvents[0]?.hookName).toBe('defer-hook')
})
