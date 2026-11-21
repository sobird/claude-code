import { expect, test } from 'bun:test'

import { createAccessTokenStore, type TokenMintResult } from '@/lib/token-store'

/** Drain pending microtasks without touching real timers. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

test('concurrent ensureLoaded calls share one mint and notify every subscriber', async () => {
  let calls = 0
  const store = createAccessTokenStore({
    mint: async () => {
      calls += 1
      return { ok: true, token: 'tok', expiresIn: 300 }
    },
    now: () => 0,
    schedule: () => 0,
    cancel: () => {},
  })

  let notifications = 0
  store.subscribe(() => {
    notifications += 1
  })
  store.subscribe(() => {
    notifications += 1
  })

  const [first, second] = await Promise.all([store.ensureLoaded(), store.ensureLoaded()])

  expect(calls).toBe(1)
  expect(first).toBe('tok')
  expect(second).toBe('tok')
  expect(store.getSnapshot()).toEqual({ token: 'tok', error: null })
  expect(notifications).toBe(2)
})

test('concurrent refresh calls share one mint', async () => {
  let calls = 0
  let resolveMint: (result: TokenMintResult) => void = () => {}
  const store = createAccessTokenStore({
    mint: () => {
      calls += 1
      return new Promise<TokenMintResult>((resolve) => {
        resolveMint = resolve
      })
    },
    now: () => 0,
    schedule: () => 0,
    cancel: () => {},
  })

  const first = store.refresh()
  const second = store.refresh()
  expect(calls).toBe(1)

  resolveMint({ ok: true, token: 'tok', expiresIn: 300 })
  expect(await first).toBe('tok')
  expect(await second).toBe('tok')
})

test('ensureLoaded reuses a cached token outside the refresh margin', async () => {
  let calls = 0
  let current = 1_000
  const store = createAccessTokenStore({
    mint: async () => {
      calls += 1
      return { ok: true, token: 'tok', expiresIn: 300 }
    },
    now: () => current,
    schedule: () => 0,
    cancel: () => {},
  })

  expect(await store.ensureLoaded()).toBe('tok')
  expect(calls).toBe(1)

  // Two minutes before expiry: still more than the 60s margin, so no mint.
  current = 1_000 + 300_000 - 120_000
  expect(await store.ensureLoaded()).toBe('tok')
  expect(calls).toBe(1)
})

test('ensureLoaded mints again inside the refresh margin', async () => {
  let calls = 0
  let current = 1_000
  const store = createAccessTokenStore({
    mint: async () => {
      calls += 1
      return { ok: true, token: 'tok', expiresIn: 300 }
    },
    now: () => current,
    schedule: () => 0,
    cancel: () => {},
  })

  await store.ensureLoaded()
  expect(calls).toBe(1)

  // Thirty seconds before expiry: inside the margin, so refresh.
  current = 1_000 + 300_000 - 30_000
  expect(await store.ensureLoaded()).toBe('tok')
  expect(calls).toBe(2)
})

test('a scheduled refresh mints and updates the snapshot', async () => {
  const scheduled: Array<{ callback: () => void; delay: number }> = []
  let calls = 0
  const tokens = ['first', 'second']
  const store = createAccessTokenStore({
    mint: async () => {
      calls += 1
      return { ok: true, token: tokens[calls - 1], expiresIn: 300 }
    },
    now: () => 0,
    schedule: (callback, delay) => {
      scheduled.push({ callback, delay })
      return scheduled.length
    },
    cancel: () => {},
  })

  await store.ensureLoaded()
  expect(calls).toBe(1)
  expect(scheduled).toHaveLength(1)
  expect(scheduled[0].delay).toBe(240_000) // 300s TTL minus the 60s margin

  scheduled[0].callback()
  await flushMicrotasks()

  expect(calls).toBe(2)
  expect(store.getSnapshot()).toEqual({ token: 'second', error: null })
})

test('a 401 clears the token, reports Not signed in, and cancels the timer', async () => {
  let calls = 0
  const cancelled: unknown[] = []
  const store = createAccessTokenStore({
    mint: async () => {
      calls += 1
      if (calls === 1) return { ok: true, token: 'tok', expiresIn: 300 }
      return { ok: false, status: 401, message: 'unauthorized' }
    },
    now: () => 0,
    schedule: () => 1,
    cancel: (handle) => {
      cancelled.push(handle)
    },
  })

  await store.ensureLoaded()
  expect(store.getSnapshot()).toEqual({ token: 'tok', error: null })
  expect(cancelled).toHaveLength(0)

  expect(await store.refresh()).toBeNull()
  expect(store.getSnapshot()).toEqual({ token: null, error: 'Not signed in' })
  expect(cancelled).toEqual([1])
})

test('a non-401 failure keeps the previous token and surfaces the error', async () => {
  let calls = 0
  let scheduledCount = 0
  const store = createAccessTokenStore({
    mint: async () => {
      calls += 1
      if (calls === 1) return { ok: true, token: 'tok', expiresIn: 300 }
      return { ok: false, status: 500, message: 'gateway exploded' }
    },
    now: () => 0,
    schedule: () => {
      scheduledCount += 1
      return scheduledCount
    },
    cancel: () => {},
  })

  await store.ensureLoaded()
  expect(scheduledCount).toBe(1)

  expect(await store.refresh()).toBeNull()
  expect(store.getSnapshot()).toEqual({ token: 'tok', error: 'gateway exploded' })
  // A failed attempt must not schedule an expiry timer of its own.
  expect(scheduledCount).toBe(1)
})

test('snapshot identity is stable while values are unchanged', async () => {
  let calls = 0
  const store = createAccessTokenStore({
    mint: async () => {
      calls += 1
      if (calls === 1) return { ok: true, token: 'tok', expiresIn: 300 }
      return { ok: false, status: 500, message: 'gateway exploded' }
    },
    now: () => 0,
    schedule: () => 0,
    cancel: () => {},
  })

  const initial = store.getSnapshot()
  expect(store.getSnapshot()).toBe(initial)

  let notifications = 0
  store.subscribe(() => {
    notifications += 1
  })

  await store.ensureLoaded()
  const loaded = store.getSnapshot()
  expect(loaded).not.toBe(initial)
  expect(store.getSnapshot()).toBe(loaded)
  expect(notifications).toBe(1)

  await store.refresh()
  const failed = store.getSnapshot()
  expect(failed).not.toBe(loaded)
  expect(failed).toEqual({ token: 'tok', error: 'gateway exploded' })
  expect(notifications).toBe(2)

  // Repeating the same failure leaves values unchanged: same object, no notify.
  await store.refresh()
  expect(store.getSnapshot()).toBe(failed)
  expect(notifications).toBe(2)
})
