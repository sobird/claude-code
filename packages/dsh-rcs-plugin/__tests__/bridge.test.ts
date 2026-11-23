import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { FakeRcs, waitFor } from '@sobird/dsh-bridge/testing'

import { startPluginBridge, type PluginBridge } from '../src/bridge'
import type { ResolvedConfig } from '../src/config'
import { FakeAgent, FakeContext } from './helpers/fake-ctx'

const SESSION_ID = 'cse_plugin'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

describe('dsh-rcs-plugin bridge', () => {
  let rcs: FakeRcs
  let ctx: FakeContext
  let bridge: PluginBridge

  const config = (): ResolvedConfig => ({
    rcsBaseUrl: rcs.origin,
    apiKey: 'test-key',
    workdir: '/tmp/rcs-work',
    sessionTitle: 'integration',
    provider: 'test-provider',
    model: 'test-model',
    sessionId: undefined,
  })

  beforeEach(async () => {
    rcs = new FakeRcs(SESSION_ID)
    rcs.start()
    ctx = new FakeContext()
    bridge = await startPluginBridge(ctx, config())
  })

  afterEach(async () => {
    await bridge.stop()
    rcs.stop()
  })

  test('attaches to a fresh RCS session with heartbeat and idle status', async () => {
    expect(bridge.sessionId).toBe(SESSION_ID)
    await waitFor(() => (rcs.heartbeats > 0 ? true : undefined), 'first heartbeat')
    await waitFor(() => (rcs.statuses.some((entry) => entry.status === 'idle') ? true : undefined), 'idle status')
  }, 15000)

  test('a prompt lazily creates the dsh session and freezes the user message', async () => {
    rcs.push({ type: 'user', message: { role: 'user', content: 'hello plugin' } })

    const created = await waitFor(() => ctx.agents.creates[0], 'agent create')
    expect(created).toMatchObject({
      sessionId: SESSION_ID,
      meta: { cwd: '/tmp/rcs-work' },
      agentOptions: { provider: 'test-provider', model: 'test-model' },
    })

    const agent = await waitFor(() => ctx.agents.live.get(SESSION_ID), 'live agent')
    const message = await waitFor(() => agent.followups[0], 'followup message')
    expect(Object.isFrozen(message)).toBe(true)
    expect(message).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'hello plugin' }],
      source: { kind: 'user' },
    })
    await waitFor(() => rcs.statuses.find((entry) => entry.status === 'running'), 'running status')
  }, 15000)

  test('session events translate to RCS events in order and finish idle', async () => {
    ctx.emitSessionEvent(SESSION_ID, {
      type: 'assistant/message',
      seq: 1,
      data: { message: { content: [{ type: 'text', text: 'hi' }] } },
    })
    ctx.emitSessionEvent(SESSION_ID, {
      type: 'tool/call',
      seq: 2,
      data: { callId: 'c1', name: 'bash', arguments: '{"command":"echo hi"}' },
    })
    ctx.emitSessionEvent(SESSION_ID, {
      type: 'tool/result',
      seq: 3,
      data: { message: { toolCallId: 'c1', content: [{ type: 'text', text: 'hi' }], isError: false } },
    })
    ctx.emitSessionEvent(SESSION_ID, { type: 'turn/end', seq: 4, data: { reason: { kind: 'completed' } } })

    const result = await waitFor(() => rcs.events.find((event) => event.type === 'result'), 'result event')
    expect(result).toMatchObject({ subtype: 'success' })
    expect(rcs.events.map((event) => event.type)).toEqual(['assistant', 'tool_use', 'user', 'result'])
    await waitFor(
      () => (rcs.statuses.length > 0 && rcs.statuses[rcs.statuses.length - 1]?.status === 'idle' ? true : undefined),
      'idle after turn',
    )
  }, 15000)

  test('ignores events from other sessions', async () => {
    ctx.emitSessionEvent('cse_other', {
      type: 'assistant/message',
      seq: 1,
      data: { message: { content: [{ type: 'text', text: 'not ours' }] } },
    })
    await Bun.sleep(100)
    expect(rcs.events).toHaveLength(0)
  }, 15000)

  test('approval becomes a permission card and remembers always-allow', async () => {
    const agent = new FakeAgent(SESSION_ID)
    ctx.agents.live.set(SESSION_ID, agent)

    const outcome = ctx.requestApproval({ agent, toolName: 'bash', reason: 'run bash' }, async () => 'unavailable')
    const card = await waitFor(
      () => rcs.events.find((event) => event.type === 'control_request' && isRecord(event.request)),
      'approval card',
    )
    expect(card.request).toMatchObject({ subtype: 'can_use_tool', tool_name: 'bash' })
    await waitFor(
      () =>
        rcs.statuses.some(
          (entry) =>
            entry.status === 'requires_action' && isRecord(entry.details) && entry.details.tool_name === 'bash',
        )
          ? true
          : undefined,
      'requires_action status',
    )

    rcs.push({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: card.request_id,
        response: {
          behavior: 'allow',
          updatedPermissions: [{ type: 'addRules', behavior: 'allow', rules: [{ toolName: 'bash' }] }],
        },
      },
    })
    expect(await outcome).toBe('allowed-once')

    const again = await ctx.requestApproval({ agent, toolName: 'bash' }, async () => 'unavailable')
    expect(again).toBe('allowed-once')
    expect(rcs.events.filter((event) => event.type === 'control_request')).toHaveLength(1)
  }, 15000)

  test('a plan-review question becomes an ExitPlanMode card and approves', async () => {
    const agent = new FakeAgent(SESSION_ID)
    ctx.agents.live.set(SESSION_ID, agent)

    const answer = ctx.requestQuestion(
      {
        agent,
        questions: [
          {
            id: 'plan-review',
            question: 'Approve plan?',
            detail: '# Plan',
            intent: { kind: 'plan-review', approve: 'Approve' },
            options: [{ label: 'Approve' }, { label: 'Keep planning' }],
          },
        ],
      },
      async () => ({ cancelled: true }),
    )

    const card = await waitFor(
      () => rcs.events.find((event) => event.type === 'control_request' && isRecord(event.request)),
      'question card',
    )
    expect(card.request).toMatchObject({ tool_name: 'ExitPlanMode', input: { plan: '# Plan' } })
    await waitFor(
      () =>
        rcs.statuses.some(
          (entry) =>
            entry.status === 'requires_action' && isRecord(entry.details) && entry.details.tool_name === 'ExitPlanMode',
        )
          ? true
          : undefined,
      'requires_action status',
    )

    rcs.push({
      type: 'control_response',
      response: { subtype: 'success', request_id: card.request_id, response: { behavior: 'allow' } },
    })
    expect(await answer).toEqual({ answers: [{ id: 'plan-review', selected: ['Approve'] }] })
  }, 15000)

  test('approval for a foreign agent defers to the next handler', async () => {
    const outcome = await ctx.requestApproval(
      { agent: new FakeAgent('cse_other'), toolName: 'bash' },
      async () => 'unavailable',
    )
    expect(outcome).toBe('unavailable')
    expect(rcs.events).toHaveLength(0)
  }, 15000)

  test('interrupt cancels the pending card and produces one aborted result', async () => {
    const agent = new FakeAgent(SESSION_ID)
    ctx.agents.live.set(SESSION_ID, agent)
    ctx.emitSessionEvent(SESSION_ID, { type: 'turn/start', seq: 1, data: {} })

    const outcome = ctx.requestApproval({ agent, toolName: 'bash' }, async () => 'unavailable')
    await waitFor(() => rcs.events.find((event) => event.type === 'control_request'), 'approval card')

    rcs.push({ type: 'control_request', request: { subtype: 'interrupt' } })
    await waitFor(() => rcs.events.find((event) => event.type === 'control_response'), 'cancelled card')
    expect(await outcome).toBe('cancelled')
    await waitFor(() => (agent.cancels.length === 1 ? true : undefined), 'agent cancel')

    ctx.emitSessionEvent(SESSION_ID, { type: 'turn/end', seq: 2, data: { reason: { kind: 'aborted' } } })
    await waitFor(() => rcs.events.find((event) => event.type === 'result'), 'aborted result')
    const aborted = rcs.events.filter((event) => event.type === 'result')
    expect(aborted).toHaveLength(1)
    expect(aborted[0]).toMatchObject({ subtype: 'aborted', is_error: true, result: 'Interrupted' })
  }, 15000)

  test('stop settles pending cards, cancels the agent and reports idle', async () => {
    const agent = new FakeAgent(SESSION_ID)
    ctx.agents.live.set(SESSION_ID, agent)

    const outcome = ctx.requestApproval({ agent, toolName: 'bash' }, async () => 'unavailable')
    await waitFor(() => rcs.events.find((event) => event.type === 'control_request'), 'approval card')

    await bridge.stop()
    expect(await outcome).toBe('cancelled')
    expect(agent.cancels).toHaveLength(1)
    expect(rcs.events.find((event) => event.type === 'control_response')).toBeDefined()
    expect(rcs.statuses[rcs.statuses.length - 1]?.status).toBe('idle')
  }, 15000)
})
