import { beforeEach, describe, expect, test } from 'bun:test'

import { connectPresence, isSessionVisible, resetPresenceForTests, setPresenceVisible } from '../presence.js'

beforeEach(() => resetPresenceForTests())

describe('session presence', () => {
  test('a connected client is not visible until it reports visible', () => {
    const release = connectPresence('s1', 'c1')

    expect(isSessionVisible('s1')).toBe(false)
    expect(setPresenceVisible('s1', 'c1', true)).toBe(true)
    expect(isSessionVisible('s1')).toBe(true)

    release()
  })

  test('reporting visibility for an unknown client is ignored', () => {
    expect(setPresenceVisible('s1', 'ghost', true)).toBe(false)
    expect(isSessionVisible('s1')).toBe(false)
  })

  test('disconnect drops the client and its visible claim', () => {
    const release = connectPresence('s1', 'c1')
    setPresenceVisible('s1', 'c1', true)

    release()

    expect(isSessionVisible('s1')).toBe(false)
    expect(setPresenceVisible('s1', 'c1', true)).toBe(false)
  })

  test('a hidden client does not mask another visible one', () => {
    const a = connectPresence('s1', 'a')
    const b = connectPresence('s1', 'b')
    setPresenceVisible('s1', 'a', false)
    setPresenceVisible('s1', 'b', true)

    expect(isSessionVisible('s1')).toBe(true)

    a()
    b()
  })

  test('disconnecting the visible client clears the session', () => {
    const a = connectPresence('s1', 'a')
    const b = connectPresence('s1', 'b')
    setPresenceVisible('s1', 'a', true)
    setPresenceVisible('s1', 'b', false)

    a()

    expect(isSessionVisible('s1')).toBe(false)
    b()
  })

  test('release is idempotent', () => {
    const release = connectPresence('s1', 'c1')

    release()
    release()

    expect(setPresenceVisible('s1', 'c1', true)).toBe(false)
  })

  test('sessions are independent', () => {
    const release = connectPresence('s1', 'c1')
    setPresenceVisible('s1', 'c1', true)

    expect(isSessionVisible('s2')).toBe(false)

    release()
  })

  test('a reconnect with the same client id stays registered until the last release', () => {
    const first = connectPresence('s1', 'c1')
    const second = connectPresence('s1', 'c1')
    setPresenceVisible('s1', 'c1', true)

    first()

    expect(isSessionVisible('s1')).toBe(true)

    second()

    expect(isSessionVisible('s1')).toBe(false)
  })
})
