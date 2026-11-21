import { beforeEach, describe, expect, test } from 'bun:test'

import type { GatewayConfig } from '@/config'
import { loadConfig } from '@/config'
import { createMemoryRepositories } from '@/db/repositories'
import type { Repositories } from '@/db/repositories/types'
import {
  isSessionStale,
  runDisconnectMonitorSweep,
  startDisconnectMonitor,
  stopDisconnectMonitor,
} from '@/services/disconnect-monitor'
import { getAllEventBuses, getEventBus, removeEventBus } from '@/transport/event-bus'

const AUTH_SECRET = 'test-secret'
const DISCONNECT_TIMEOUT_SECONDS = 300

describe('session staleness', () => {
  const timeoutMs = DISCONNECT_TIMEOUT_SECONDS * 1000
  const now = Date.parse('2026-05-01T12:00:00.000Z')
  const staleDate = new Date(now - timeoutMs * 2 - 1)
  const freshDate = new Date(now - 1_000)

  test('a recently updated session is live', () => {
    expect(
      isSessionStale({
        sessionUpdatedAt: freshDate,
        latestEventAt: null,
        environmentLastPollAt: null,
        now,
        timeoutMs,
      }),
    ).toBe(false)
  })

  test('a recent event keeps an otherwise quiet session live', () => {
    expect(
      isSessionStale({
        sessionUpdatedAt: staleDate,
        latestEventAt: freshDate,
        environmentLastPollAt: null,
        now,
        timeoutMs,
      }),
    ).toBe(false)
  })

  test('a polling environment keeps an idle session live', () => {
    expect(
      isSessionStale({
        sessionUpdatedAt: staleDate,
        latestEventAt: staleDate,
        environmentLastPollAt: freshDate,
        now,
        timeoutMs,
      }),
    ).toBe(false)
  })

  test('a session with no recent activity anywhere is stale', () => {
    expect(
      isSessionStale({
        sessionUpdatedAt: staleDate,
        latestEventAt: staleDate,
        environmentLastPollAt: staleDate,
        now,
        timeoutMs,
      }),
    ).toBe(true)
    expect(
      isSessionStale({
        sessionUpdatedAt: staleDate,
        latestEventAt: null,
        environmentLastPollAt: null,
        now,
        timeoutMs,
      }),
    ).toBe(true)
  })
})

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

  test('keeps a quiet session alive while its environment is still polling', async () => {
    const timeoutMs = DISCONNECT_TIMEOUT_SECONDS * 1000
    // The sweep clock is 2x the window past "now" so the session row itself is stale; only
    // the environment's poll proves the worker machine is still connected.
    const now = Date.now() + timeoutMs * 2 + 60_000
    const env = await repos.environments.create({
      ownerUserId: 'user_1',
      lastPollAt: new Date(now - 30_000),
    })
    const session = await repos.sessions.create({ environmentId: env.id })
    await repos.sessions.update(session.id, { status: 'idle' })

    await runDisconnectMonitorSweep(repos, config, now)

    expect((await repos.sessions.getById(session.id))?.status).toBe('idle')
  })

  test('start and stop are idempotent', () => {
    startDisconnectMonitor({ repos, config })
    startDisconnectMonitor({ repos, config })
    stopDisconnectMonitor()
    stopDisconnectMonitor()
  })
})
