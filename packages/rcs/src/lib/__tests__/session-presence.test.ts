import { describe, expect, test } from 'bun:test'

import { buildSessionEventsUrl, createPresenceReporter } from '../session-presence'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('session presence client helpers', () => {
  test('builds the events URL with the presence client id', () => {
    expect(buildSessionEventsUrl('https://rcs.example', 'session_abc', 'c 1')).toBe(
      'https://rcs.example/web/sessions/session_abc/events?client_id=c%201',
    )
  })

  test('reports visibility through the api client', async () => {
    const calls: Array<{ path: string; body: unknown }> = []
    const api = {
      async post(path: string, body?: unknown) {
        calls.push({ path, body })
      },
    }

    const report = createPresenceReporter(api, 'session_abc', 'c1')
    report(true)
    await flush()

    expect(calls).toEqual([{ path: '/web/sessions/session_abc/presence', body: { client_id: 'c1', visible: true } }])
  })

  test('swallows report failures so teardown paths never reject', async () => {
    const api = {
      post() {
        return Promise.reject(new Error('offline'))
      },
    }

    const report = createPresenceReporter(api, 'session_abc', 'c1')

    expect(() => report(false)).not.toThrow()
    await flush()
  })
})
