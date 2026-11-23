import { describe, expect, test } from 'bun:test'

import { compareSessions, sessionCounts, sessionFace, splitAwaiting, sortSessions } from '../session-status'
import type { SessionSummary } from '../types'

let seq = 0
function session(patch: Partial<SessionSummary> = {}): SessionSummary {
  seq += 1
  return {
    id: `session_${seq}`,
    title: null,
    status: 'idle',
    environment_id: null,
    owner_user_id: null,
    updated_at: patch.updated_at ?? seq,
    ...patch,
  }
}

describe('session presentation', () => {
  test('awaiting wins over unread and running', () => {
    expect(
      sessionFace(
        session({
          status: 'running',
          unread: true,
          awaiting: { kind: 'permission', tool_name: 'Bash', description: 'Run tests' },
        }),
      ),
    ).toBe('awaiting')
  })

  test('unread before running, running before idle', () => {
    expect(sessionFace(session({ unread: true }))).toBe('unread')
    expect(sessionFace(session({ status: 'running' }))).toBe('running')
    expect(sessionFace(session({ status: 'inactive' }))).toBe('idle')
  })

  test('sort puts awaiting first, then unread, running, and newest idle', () => {
    const idleOld = session({ updated_at: 1 })
    const idleNew = session({ updated_at: 9 })
    const running = session({ status: 'running', updated_at: 2 })
    const unread = session({ unread: true, updated_at: 3 })
    const awaiting = session({
      updated_at: 4,
      awaiting: { kind: 'question', tool_name: 'AskUserQuestion', description: null },
    })

    expect(sortSessions([idleOld, running, idleNew, unread, awaiting]).map((item) => item.id)).toEqual([
      awaiting.id,
      unread.id,
      running.id,
      idleNew.id,
      idleOld.id,
    ])
  })

  test('compareSessions keeps updated_at descending within a face', () => {
    const older = session({ updated_at: 10 })
    const newer = session({ updated_at: 20 })
    expect(compareSessions(newer, older)).toBeLessThan(0)
  })

  test('sessionCounts counts awaiting and unread without double counting', () => {
    const awaiting = session({
      unread: true,
      awaiting: { kind: 'permission', tool_name: 'Bash', description: null },
    })
    const unread = session({ unread: true })
    const running = session({ status: 'running' })
    const idle = session()

    expect(sessionCounts([awaiting, unread, running, idle])).toEqual({ awaiting: 1, unread: 1 })
    expect(sessionCounts([])).toEqual({ awaiting: 0, unread: 0 })
  })

  test('splitAwaiting separates blocking sessions without reordering the rest', () => {
    const first = session()
    const blocked = session({
      awaiting: { kind: 'plan', tool_name: 'ExitPlanMode', description: null },
    })
    const second = session()

    const split = splitAwaiting([first, blocked, second])
    expect(split.awaiting.map((item) => item.id)).toEqual([blocked.id])
    expect(split.rest.map((item) => item.id)).toEqual([first.id, second.id])
  })
})
