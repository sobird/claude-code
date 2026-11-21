import { describe, expect, test } from 'bun:test'

import { selectVisibleEnvironments, selectVisibleSessions } from '@/components/shell/selectors'

interface OwnedItem {
  id: string
  owner: string | null
}

const member = { id: 'a', role: 'member' }
const admin = { id: 'x', role: 'admin' }

const sessions: OwnedItem[] = [
  { id: 's1', owner: 'a' },
  { id: 's2', owner: 'b' },
  { id: 's3', owner: null },
]

const environments: OwnedItem[] = [
  { id: 'e1', owner: 'a' },
  { id: 'e2', owner: 'b' },
  { id: 'e3', owner: null },
]

describe('selectVisibleSessions', () => {
  test('members see their own sessions and unclaimed ones, never another owner', () => {
    const visible = selectVisibleSessions(sessions, member)
    expect(visible.map((session) => session.id)).toEqual(['s1', 's3'])
    expect(visible.some((session) => session.owner === 'b')).toBe(false)
  })

  test('admins see every session including unclaimed ones', () => {
    const visible = selectVisibleSessions(sessions, admin)
    expect(visible.map((session) => session.id)).toEqual(['s1', 's2', 's3'])
  })
})

describe('selectVisibleEnvironments', () => {
  test('members see owned or unowned environments; admins see all', () => {
    expect(selectVisibleEnvironments(environments, member).map((env) => env.id)).toEqual(['e1', 'e3'])
    expect(selectVisibleEnvironments(environments, admin)).toHaveLength(3)
  })

  test('admins see environments owned by other users', () => {
    expect(selectVisibleEnvironments(environments, admin).map((env) => env.id)).toEqual(['e1', 'e2', 'e3'])
  })
})
