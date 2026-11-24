import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FakeRcs, waitFor } from '@sobird/dsh-bridge/testing'

import type { ResolvedConfig } from '../src/config'
import { startSupervisor } from '../src/supervisor'
import { FakeContext, FakeSessionTitle } from './helpers/fake-ctx'

function envConfig(origin: string): ResolvedConfig {
  return {
    rcsBaseUrl: origin,
    apiKey: 'test-key',
    workdir: '/tmp/rcs-work',
    sessionTitle: undefined,
    provider: 'test-provider',
    model: 'test-model',
    sessionId: undefined,
    mode: 'environment',
    environmentId: undefined,
    maxSessions: 2,
  }
}

describe('environment supervisor', () => {
  let previousDshHome: string | undefined

  beforeEach(async () => {
    previousDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'rcs-supervisor-'))
  })

  afterEach(() => {
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
  })

  test('a work item starts one bridge and acks it', async () => {
    const rcs = new FakeRcs('cse_a')
    rcs.start()
    const supervisor = await startSupervisor(new FakeContext(), envConfig(rcs.origin), { emptyPollDelayMs: 20 })
    try {
      rcs.enqueueWork('cse_a')
      await waitFor(() => (supervisor.bridgeIds().includes('cse_a') ? true : undefined), 'bridge start')
      expect(rcs.acked).toHaveLength(1)
      await waitFor(() => (rcs.statuses.some((entry) => entry.status === 'idle') ? true : undefined), 'idle status')
    } finally {
      await supervisor.dispose()
      rcs.stop()
    }
  }, 15000)

  test('a dispatched session adopts the RCS title for dsh naming', async () => {
    const rcs = new FakeRcs('cse_title')
    rcs.sessionTitle = 'From RCS'
    rcs.start()
    const ctx = new FakeContext()
    const titles = new FakeSessionTitle()
    ctx.provide('sessionTitle', titles)
    const supervisor = await startSupervisor(ctx, envConfig(rcs.origin), { emptyPollDelayMs: 20 })
    try {
      rcs.enqueueWork('cse_title')
      await waitFor(() => (supervisor.bridgeIds().includes('cse_title') ? true : undefined), 'bridge start')
      rcs.push({ type: 'user', message: { role: 'user', content: 'hello' } })

      const renamed = await waitFor(() => titles.renames[0], 'title rename')
      expect(renamed).toEqual({ sessionId: 'cse_title', title: 'From RCS' })
    } finally {
      await supervisor.dispose()
      rcs.stop()
    }
  }, 15000)

  test('duplicate delivery does not create a second bridge', async () => {
    const rcs = new FakeRcs('cse_a')
    rcs.start()
    const supervisor = await startSupervisor(new FakeContext(), envConfig(rcs.origin), { emptyPollDelayMs: 20 })
    try {
      rcs.enqueueWork('cse_a')
      rcs.enqueueWork('cse_a')
      await waitFor(() => (supervisor.bridgeIds().length === 1 ? true : undefined), 'single bridge')
      await Bun.sleep(100)
      expect(supervisor.bridgeIds()).toEqual(['cse_a'])
    } finally {
      await supervisor.dispose()
      rcs.stop()
    }
  }, 15000)

  // 桥收掉时对应的工作项要显式停止，否则 acked 行会一直挂着。
  test('disposing stops every dispatched work item', async () => {
    const rcs = new FakeRcs('cse_stop')
    rcs.start()
    const supervisor = await startSupervisor(new FakeContext(), envConfig(rcs.origin), { emptyPollDelayMs: 20 })
    rcs.enqueueWork('cse_stop')
    await waitFor(() => (supervisor.bridgeIds().includes('cse_stop') ? true : undefined), 'bridge start')
    await supervisor.dispose()
    rcs.stop()
    expect(rcs.acked).toHaveLength(1)
    expect(rcs.stopped).toEqual(rcs.acked)
  }, 15000)

  // begin() 中途失败时要把半注册的监听器收回来，否则会话槽位看似空闲、监听器却一直残留。
  test('a failed begin() unregisters its listeners and frees the slot', async () => {
    const rcs = new FakeRcs('cse_begin')
    rcs.start()
    const ctx = new FakeContext()
    const supervisor = await startSupervisor(ctx, envConfig(rcs.origin), { emptyPollDelayMs: 20 })
    try {
      ctx.failNextOn = 'agent/status'
      rcs.enqueueWork('cse_begin')
      await waitFor(() => (ctx.failNextOn === null ? true : undefined), 'begin failure')
      expect(supervisor.bridgeIds()).toEqual([])
      expect(ctx.listenerCount).toBe(0)
    } finally {
      await supervisor.dispose()
      rcs.stop()
    }
  }, 15000)

  // 手工同步映射读不出来时仍应起桥（环境派发的会话本来就不依赖映射）。
  test('an unreadable sidecar is logged and dispatch still starts the bridge', async () => {
    // 用同名目录制造 EISDIR，模拟权限/损坏之外的真实读取失败。
    await mkdir(join(process.env.DSH_HOME ?? '', 'rcs-bridge', 'sessions.json'), { recursive: true })
    const rcs = new FakeRcs('cse_sidecar')
    rcs.start()
    const supervisor = await startSupervisor(new FakeContext(), envConfig(rcs.origin), { emptyPollDelayMs: 20 })
    try {
      rcs.enqueueWork('cse_sidecar')
      await waitFor(() => (supervisor.bridgeIds().includes('cse_sidecar') ? true : undefined), 'bridge start')
    } finally {
      await supervisor.dispose()
      rcs.stop()
    }
  }, 15000)

  test('maxSessions changes locally even when re-registering fails', async () => {
    const rcs = new FakeRcs('cse_c')
    rcs.start()
    const supervisor = await startSupervisor(new FakeContext(), envConfig(rcs.origin), { emptyPollDelayMs: 20 })
    try {
      rcs.environmentRegisterStatus = 500
      await supervisor.setMaxSessions(6)
      expect(supervisor.maxSessions).toBe(6)
    } finally {
      await supervisor.dispose()
      rcs.stop()
    }
  }, 15000)

  test('a 401 during poll re-registers and keeps working', async () => {
    const rcs = new FakeRcs('cse_b')
    rcs.start()
    const supervisor = await startSupervisor(new FakeContext(), envConfig(rcs.origin), { emptyPollDelayMs: 20 })
    try {
      rcs.nextPollStatus = 401
      await waitFor(() => (rcs.environmentRegistrations.length >= 2 ? true : undefined), 're-register')
      rcs.enqueueWork('cse_b')
      await waitFor(() => (supervisor.bridgeIds().includes('cse_b') ? true : undefined), 'work after re-register')
    } finally {
      await supervisor.dispose()
      rcs.stop()
    }
  }, 15000)
})
