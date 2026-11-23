import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { BridgeConfig } from '../config'
import { startBridge, type Bridge } from '../session'
import { FakeRcs, waitFor } from '../testing/fake-rcs'
import { isRecord } from '../util'

const SESSION_ID = 'cse_test'

describe('dsh-bridge integration', () => {
  let rcs: FakeRcs
  let bridge: Bridge
  let dir: string
  let logPath: string

  const readLog = (): Record<string, unknown>[] => {
    if (!existsSync(logPath)) return []
    const text = readFileSync(logPath, 'utf8').trim()
    if (!text) return []
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }

  const logKind = (kind: string): Record<string, unknown> | undefined => readLog().find((entry) => entry.kind === kind)

  const config = (): BridgeConfig => ({
    rcsBaseUrl: rcs.origin,
    apiKey: 'test-key',
    workdir: dir,
    title: 'integration',
    provider: 'test-provider',
    model: 'test-model',
    dsh: { command: process.execPath, args: [join(import.meta.dir, 'fixtures', 'fake-dsh.mjs')], cwd: dir },
  })

  beforeEach(async () => {
    rcs = new FakeRcs(SESSION_ID)
    rcs.start()
    dir = mkdtempSync(join(tmpdir(), 'dsh-bridge-'))
    logPath = join(dir, 'dsh.log')
    process.env.FAKE_DSH_LOG = logPath
    bridge = await startBridge(config())
  })

  afterEach(async () => {
    await bridge.stop()
    rcs.stop()
    delete process.env.FAKE_DSH_LOG
    rmSync(dir, { recursive: true, force: true })
  })

  test('attaches with a heartbeat and idle status', async () => {
    expect(bridge.sessionId).toBe(SESSION_ID)
    await waitFor(() => (rcs.heartbeats > 0 ? true : undefined), 'first heartbeat')
    await waitFor(() => (rcs.statuses.some((entry) => entry.status === 'idle') ? true : undefined), 'idle status')
  }, 15000)

  test('a prompt fans out to assistant, tool_use, tool_result and result', async () => {
    rcs.push({ type: 'user', message: { role: 'user', content: 'hello' } })

    const assistant = await waitFor(() => rcs.events.find((event) => event.type === 'assistant'), 'assistant event')
    expect(assistant.message).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'hello from fake dsh' }],
    })

    const toolUse = await waitFor(() => rcs.events.find((event) => event.type === 'tool_use'), 'tool_use event')
    expect(toolUse).toMatchObject({ tool_call_id: 'call_1', tool_name: 'bash', tool_input: { command: 'echo hi' } })

    const toolResult = await waitFor(() => rcs.events.find((event) => event.type === 'user'), 'tool_result event')
    expect(toolResult.message).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_1',
          content: [{ type: 'text', text: 'hi' }],
          is_error: false,
        },
      ],
    })

    const result = await waitFor(() => rcs.events.find((event) => event.type === 'result'), 'result event')
    expect(result).toMatchObject({ subtype: 'success' })

    expect(rcs.statuses.some((entry) => entry.status === 'running')).toBe(true)
    expect(logKind('prompt')).toMatchObject({ text: 'hello', sessionId: SESSION_ID })
  }, 15000)

  test('unwraps the real gateway worker envelope', async () => {
    rcs.pushEnvelope('user', {
      type: 'user',
      uuid: 'u-env',
      message: { role: 'user', content: 'hello envelope' },
    })

    const assistant = await waitFor(() => rcs.events.find((event) => event.type === 'assistant'), 'assistant event')
    expect(assistant.message).toMatchObject({ role: 'assistant' })
    expect(logKind('prompt')).toMatchObject({ text: 'hello envelope' })
  }, 15000)

  test('approval round-trips as a permission card and an allowed-once outcome', async () => {
    rcs.push({ type: 'user', message: { role: 'user', content: 'approval please' } })

    const card = await waitFor(
      () => rcs.events.find((event) => event.type === 'control_request' && isRecord(event.request)),
      'approval card',
    )
    expect(card.request).toMatchObject({ subtype: 'can_use_tool', tool_name: 'bash' })
    expect(card.request_id).toBeTruthy()

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
      response: { subtype: 'success', request_id: card.request_id, response: { behavior: 'allow' } },
    })

    const outcome = await waitFor(() => logKind('approval-outcome'), 'approval outcome', 4000)
    expect(outcome.outcome).toBe('allowed-once')
    await waitFor(() => rcs.events.find((event) => event.type === 'result'), 'result after approval')
  }, 15000)

  test('a plan-review question becomes an ExitPlanMode card and approves', async () => {
    rcs.push({ type: 'user', message: { role: 'user', content: 'question please' } })

    const card = await waitFor(
      () => rcs.events.find((event) => event.type === 'control_request' && isRecord(event.request)),
      'question card',
    )
    expect(card.request).toMatchObject({
      tool_name: 'ExitPlanMode',
      input: { plan: '# Plan\n\n1. fake step' },
    })

    rcs.push({
      type: 'control_response',
      response: { subtype: 'success', request_id: card.request_id, response: { behavior: 'allow' } },
    })

    const answered = await waitFor(() => logKind('question-answer'), 'question answer', 4000)
    expect(answered.answer).toEqual({ answers: [{ id: 'plan-review', selected: ['Approve'] }] })
  }, 15000)

  test('interrupt synthesizes an aborted result and the next prompt resumes', async () => {
    rcs.push({ type: 'user', message: { role: 'user', content: 'slow turn' } })
    await waitFor(() => (rcs.statuses.some((entry) => entry.status === 'running') ? true : undefined), 'running status')

    rcs.push({ type: 'control_request', request: { subtype: 'interrupt' } })
    const aborted = await waitFor(
      () => rcs.events.find((event) => event.type === 'result' && event.subtype === 'aborted'),
      'aborted result',
    )
    expect(aborted).toMatchObject({ is_error: true, result: 'Interrupted' })

    rcs.push({ type: 'user', message: { role: 'user', content: 'hello again' } })
    await waitFor(() => logKind('resume'), 'session/resume after interrupt', 4000)
    const assistant = await waitFor(
      () => rcs.events.find((event) => event.type === 'assistant'),
      'assistant after resume',
    )
    expect(assistant.message).toMatchObject({ role: 'assistant' })
  }, 20000)
})
