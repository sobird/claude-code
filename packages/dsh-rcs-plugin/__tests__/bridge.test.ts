import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { RcsClient } from '@sobird/dsh-bridge/core'
import { FakeRcs, waitFor } from '@sobird/dsh-bridge/testing'

import { startPluginBridge, type PluginBridge } from '../src/bridge'
import type { ResolvedConfig } from '../src/config'
import { FakeAgent, FakeContext, FakeSessionTitle, FakeWorkspaceRegistry } from './helpers/fake-ctx'

const SESSION_ID = 'cse_plugin'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 从记录下来的 `stream_event` 里取出 `content_block_delta` 的 `delta`。 */
function streamDeltas(events: Record<string, unknown>[]): Record<string, unknown>[] {
  const deltas: Record<string, unknown>[] = []
  for (const event of events) {
    const stream = isRecord(event.event) ? event.event : null
    if (stream?.type !== 'content_block_delta') continue
    const delta = isRecord(stream.delta) ? stream.delta : null
    if (delta) deltas.push(delta)
  }
  return deltas
}

describe('dsh-rcs-plugin bridge', () => {
  let rcs: FakeRcs
  let ctx: FakeContext
  let bridge: PluginBridge

  const config = (origin: string = rcs.origin): ResolvedConfig => ({
    rcsBaseUrl: origin,
    apiKey: 'test-key',
    workdir: '/tmp/rcs-work',
    sessionTitle: 'integration',
    provider: 'test-provider',
    model: 'test-model',
    sessionId: undefined,
    mode: 'single',
    environmentId: undefined,
    maxSessions: 4,
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
    expect(bridge.rcsSessionId).toBe(SESSION_ID)
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

  test('a prompt attaches the new session to the workdir workspace and syncs its title', async () => {
    const registry = new FakeWorkspaceRegistry()
    const sessionTitle = new FakeSessionTitle()
    ctx.provide('workspaceRegistry', registry)
    ctx.provide('sessionTitle', sessionTitle)

    rcs.push({ type: 'user', message: { role: 'user', content: 'hello workspace' } })

    await waitFor(() => registry.workspace.attachments[0], 'workspace attach')
    expect(registry.creates).toEqual(['/tmp/rcs-work'])
    expect(registry.order).toEqual(['create:/tmp/rcs-work', `attach:${SESSION_ID}`])
    await waitFor(() => sessionTitle.renames[0], 'title rename')
    expect(sessionTitle.renames[0]).toEqual({ sessionId: SESSION_ID, title: 'integration' })
  }, 15000)

  test('a workspace attach failure is logged without failing the prompt', async () => {
    const registry = new FakeWorkspaceRegistry()
    registry.failure = new Error('workspace unavailable')
    ctx.provide('workspaceRegistry', registry)

    rcs.push({ type: 'user', message: { role: 'user', content: 'still works' } })

    const agent = await waitFor(() => ctx.agents.live.get(SESSION_ID), 'live agent')
    await waitFor(() => agent.followups[0], 'followup despite attach failure')
    expect(rcs.events.some((event) => event.type === 'result')).toBe(false)
  }, 15000)

  test('a resumed session is attached to the workspace too', async () => {
    await bridge.stop()
    ctx.provide('sessionPersistence', { stat: async () => ({ header: { cwd: '/tmp/rcs-work' } }) })
    const registry = new FakeWorkspaceRegistry()
    ctx.provide('workspaceRegistry', registry)
    bridge = await startPluginBridge(ctx, { ...config(), sessionId: SESSION_ID })

    rcs.push({ type: 'user', message: { role: 'user', content: 'resume me' } })

    await waitFor(() => ctx.agents.resumes[0], 'agent resume')
    await waitFor(() => registry.workspace.attachments[0], 'workspace attach after resume')
    expect(registry.workspace.attachments).toEqual([SESSION_ID])
  }, 15000)

  test('a restart reuses the newest bridge session for the same workdir and resumes it', async () => {
    await bridge.stop()
    ctx.provide('sessionQuery', {
      listSessions: async () => [
        { header: { id: 'cse_elsewhere', cwd: '/tmp/other' } },
        { header: { id: SESSION_ID, cwd: '/tmp/rcs-work' } },
      ],
    })
    ctx.provide('sessionPersistence', { stat: async () => ({ header: { cwd: '/tmp/rcs-work' } }) })
    // 复用成功就不该走新建：让创建接口失败来证明这一点。
    rcs.failCreate = true
    bridge = await startPluginBridge(ctx, config())

    expect(bridge.rcsSessionId).toBe(SESSION_ID)
    rcs.push({ type: 'user', message: { role: 'user', content: 'after restart' } })
    const resumed = await waitFor(() => ctx.agents.resumes[0], 'agent resume from reused id')
    expect(resumed.resumeSessionId).toBe(SESSION_ID)
  }, 15000)

  test('an unreachable candidate falls back to a fresh session', async () => {
    await bridge.stop()
    ctx.provide('sessionQuery', { listSessions: async () => [{ header: { id: 'cse_dead', cwd: '/tmp/rcs-work' } }] })
    bridge = await startPluginBridge(ctx, config())

    // FakeRcs 只认自己的会话 id，cse_dead 的 bridge 握手会 404，于是回落到新建。
    expect(bridge.rcsSessionId).toBe(SESSION_ID)
  }, 15000)

  test('events route by agent id while posting to the rcs id', async () => {
    const rcsId = 'cse_rcs'
    const local = new FakeRcs(rcsId)
    local.start()
    const localCtx = new FakeContext()
    const agentId = 'session-local'
    const worker = {
      sessionId: rcsId,
      apiBaseUrl: local.origin,
      workerJwt: 'w',
      workerEpoch: 1,
      expiresAt: Date.now() + 60_000,
    }
    const { InProcessBridge } = await import('../src/bridge')
    const dual = new InProcessBridge(
      localCtx,
      config(local.origin),
      new RcsClient({ baseUrl: local.origin, apiKey: 'test-key' }),
      worker,
      agentId,
    )
    await dual.begin()
    localCtx.agents.live.set(agentId, new FakeAgent(agentId))
    try {
      localCtx.emitSessionEvent(agentId, { type: 'turn/end', seq: 9, data: { reason: { kind: 'completed' } } })
      await waitFor(() => local.events.find((event) => event.type === 'result'), 'result from agent id')
      localCtx.emitSessionEvent(rcsId, {
        type: 'assistant/message',
        seq: 10,
        data: { message: { content: [{ type: 'text', text: 'x' }] } },
      })
      await Bun.sleep(100)
      expect(local.events.some((event) => event.type === 'assistant')).toBe(false)
    } finally {
      await dual.stop()
      local.stop()
    }
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

  test('a prompt typed in the dsh UI is forwarded to RCS', async () => {
    ctx.emitSessionEvent(SESSION_ID, {
      type: 'user/message',
      seq: 1,
      data: {
        id: 'u-web',
        role: 'user',
        content: [{ type: 'text', text: 'from the web ui' }],
        source: { kind: 'user', rpcId: 'r1' },
      },
    })

    const forwarded = await waitFor(
      () => rcs.events.find((event) => event.type === 'user' && event.uuid === 'u-web'),
      'forwarded user message',
    )
    expect(forwarded).toMatchObject({
      message: { role: 'user', content: [{ type: 'text', text: 'from the web ui' }] },
    })
  }, 15000)

  test('prompts injected by the plugin are not echoed back to RCS', async () => {
    rcs.push({ type: 'user', message: { role: 'user', content: 'from rcs' } })
    const agent = await waitFor(() => ctx.agents.live.get(SESSION_ID), 'live agent')
    const injected = await waitFor(() => agent.followups[0], 'injected message')

    ctx.emitSessionEvent(SESSION_ID, {
      type: 'user/message',
      seq: 1,
      data: { id: injected.id, role: 'user', content: injected.content, source: { kind: 'user' } },
    })
    await Bun.sleep(150)
    expect(rcs.events.filter((event) => event.type === 'user')).toHaveLength(0)
  }, 15000)

  test('assistant stream deltas reach RCS ahead of the final message', async () => {
    ctx.agents.live.set(SESSION_ID, new FakeAgent(SESSION_ID))

    ctx.emitAssistantStream(SESSION_ID, { type: 'start' })
    ctx.emitAssistantStream(SESSION_ID, { type: 'chunk', chunk: { type: 'reasoning-delta', text: 'hmm' } })
    ctx.emitAssistantStream(SESSION_ID, { type: 'chunk', chunk: { type: 'text-delta', text: 'he' } })
    ctx.emitAssistantStream(SESSION_ID, { type: 'chunk', chunk: { type: 'text-delta', text: 'llo' } })
    ctx.emitAssistantStream(SESSION_ID, { type: 'end' })

    ctx.emitSessionEvent(SESSION_ID, {
      type: 'assistant/message',
      seq: 5,
      data: { message: { content: [{ type: 'text', text: 'hello' }] } },
    })
    ctx.emitSessionEvent(SESSION_ID, { type: 'turn/end', seq: 6, data: { reason: { kind: 'completed' } } })

    await waitFor(() => rcs.events.find((event) => event.type === 'result'), 'result event')
    expect(rcs.events.map((event) => event.type)).toEqual([
      'stream_event',
      'stream_event',
      'stream_event',
      'assistant',
      'result',
    ])
    expect(rcs.events[0]).toEqual({ type: 'stream_event', event: { type: 'message_start' } })
    expect(streamDeltas(rcs.events)).toEqual([
      { type: 'thinking_delta', thinking: 'hmm' },
      { type: 'text_delta', text: 'hello' },
    ])
  }, 15000)

  test('stop discards buffered deltas', async () => {
    ctx.agents.live.set(SESSION_ID, new FakeAgent(SESSION_ID))
    ctx.emitAssistantStream(SESSION_ID, { type: 'start' })
    ctx.emitAssistantStream(SESSION_ID, { type: 'chunk', chunk: { type: 'text-delta', text: 'partial' } })

    await bridge.stop()
    await Bun.sleep(150)

    expect(streamDeltas(rcs.events)).toHaveLength(0)
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
