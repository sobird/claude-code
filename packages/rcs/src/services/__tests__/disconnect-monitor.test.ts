import { beforeEach, describe, expect, test } from 'bun:test'

import type { GatewayConfig } from '../../config.js'
import { loadConfig } from '../../config.js'
import { createMemoryRepositories } from '../../db/repositories/index.js'
import type { Repositories } from '../../db/repositories/types.js'
import { getAllEventBuses, getEventBus, removeEventBus } from '../../transport/event-bus.js'
import { runDisconnectMonitorSweep, startDisconnectMonitor, stopDisconnectMonitor } from '../disconnect-monitor.js'

const AUTH_SECRET = 'test-secret'
const DISCONNECT_TIMEOUT_SECONDS = 300

describe('Disconnect Monitor Logic', () => {
  let repos: Repositories
  let config: GatewayConfig

  beforeEach(() => {
    process.env.RCS_AUTH_SECRET = AUTH_SECRET
    repos = createMemoryRepositories()
    config = { ...loadConfig(), disconnectTimeout: DISCONNECT_TIMEOUT_SECONDS, heartbeatInterval: 20 }
    for (const [key] of getAllEventBuses()) {
      removeEventBus(key)
    }
  })

  test('environment times out when lastPollAt is too old', async () => {
    const timeoutMs = DISCONNECT_TIMEOUT_SECONDS * 1000
    const env = await repos.environments.create({
      ownerUserId: 'user_1',
      lastPollAt: new Date(Date.now() - timeoutMs - 60_000),
    })

    await runDisconnectMonitorSweep(repos, config)

    expect((await repos.environments.getById(env.id))?.status).toBe('disconnected')
  })

  test('environment stays active when lastPollAt is recent', async () => {
    const env = await repos.environments.create({ ownerUserId: 'user_1', lastPollAt: new Date() })

    await runDisconnectMonitorSweep(repos, config)

    expect((await repos.environments.getById(env.id))?.status).toBe('active')
  })

  test('ACP agents are marked offline instead of disconnected', async () => {
    const timeoutMs = DISCONNECT_TIMEOUT_SECONDS * 1000
    const env = await repos.environments.create({
      ownerUserId: 'user_1',
      workerType: 'acp',
      lastPollAt: new Date(Date.now() - timeoutMs - 60_000),
    })

    await runDisconnectMonitorSweep(repos, config)

    expect((await repos.environments.getById(env.id))?.status).toBe('offline')
  })

  test('session becomes inactive when updatedAt is too old', async () => {
    const session = await repos.sessions.create({})
    await repos.sessions.update(session.id, { status: 'running' })

    // Advance the sweep clock past the 2x disconnect timeout window.
    const now = Date.now() + DISCONNECT_TIMEOUT_SECONDS * 1000 * 2 + 60_000
    await runDisconnectMonitorSweep(repos, config, now)

    expect((await repos.sessions.getById(session.id))?.status).toBe('inactive')
  })

  test('session stays running when recently updated', async () => {
    const session = await repos.sessions.create({})
    await repos.sessions.update(session.id, { status: 'running' })

    await runDisconnectMonitorSweep(repos, config)

    expect((await repos.sessions.getById(session.id))?.status).toBe('running')
  })

  test('session timeout publishes an inactive session_status event', async () => {
    const session = await repos.sessions.create({})
    await repos.sessions.update(session.id, { status: 'idle' })

    const bus = getEventBus(session.id)
    const events: Array<{ type: string; payload: { status?: string } }> = []
    bus.subscribe((event) => {
      events.push({ type: event.type, payload: event.payload as { status?: string } })
    })

    const now = Date.now() + DISCONNECT_TIMEOUT_SECONDS * 1000 * 2 + 60_000
    await runDisconnectMonitorSweep(repos, config, now)

    expect(events).toContainEqual({ type: 'session_status', payload: { status: 'inactive' } })
  })

  test('start and stop are idempotent', () => {
    startDisconnectMonitor({ repos, config })
    startDisconnectMonitor({ repos, config })
    stopDisconnectMonitor()
    stopDisconnectMonitor()
  })
})
