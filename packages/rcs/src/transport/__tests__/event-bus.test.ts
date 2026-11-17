import { beforeEach, describe, expect, test } from 'bun:test'

import { createMemoryRepositories } from '../../db/repositories/index.js'
import type { SessionEvent } from '../event-bus.js'
import {
  AcpEventBus,
  EventBus,
  getAllAcpEventBuses,
  getAllEventBuses,
  getAcpEventBus,
  getEventBus,
  publishInboundEvent,
  publishSessionEvent,
  removeAcpEventBus,
  removeEventBus,
} from '../event-bus.js'

let nextSeq = 1

function makeEvent(overrides: Partial<SessionEvent> & Pick<SessionEvent, 'type' | 'sessionId'>): SessionEvent {
  return {
    id: `evt-${nextSeq}`,
    payload: {},
    direction: 'outbound',
    seqNum: nextSeq++,
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('EventBus', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus()
  })

  describe('publish', () => {
    test('returns the published event unchanged', () => {
      const event = makeEvent({ type: 'user', sessionId: 's1', payload: { content: 'hello' } })
      expect(bus.publish(event)).toBe(event)
    })

    test('throws when publishing to a closed bus', () => {
      bus.close()
      expect(() => bus.publish(makeEvent({ type: 'user', sessionId: 's1' }))).toThrow('EventBus is closed')
    })
  })

  describe('subscribe', () => {
    test('receives published events', () => {
      const received: SessionEvent[] = []
      bus.subscribe((event) => received.push(event))

      const event = makeEvent({ type: 'user', sessionId: 's1', payload: { content: 'hi' } })
      bus.publish(event)

      expect(received).toHaveLength(1)
      expect(received[0]).toBe(event)
    })

    test('unsubscribe stops receiving events', () => {
      const received: SessionEvent[] = []
      const unsub = bus.subscribe((event) => received.push(event))
      unsub()
      bus.publish(makeEvent({ type: 'user', sessionId: 's1' }))
      expect(received).toHaveLength(0)
    })

    test('multiple subscribers all receive events', () => {
      const first: SessionEvent[] = []
      const second: SessionEvent[] = []
      bus.subscribe((event) => first.push(event))
      bus.subscribe((event) => second.push(event))
      bus.publish(makeEvent({ type: 'user', sessionId: 's1' }))
      expect(first).toHaveLength(1)
      expect(second).toHaveLength(1)
    })

    test('subscriber error does not affect other subscribers', () => {
      const received: SessionEvent[] = []
      bus.subscribe(() => {
        throw new Error('boom')
      })
      bus.subscribe((event) => received.push(event))
      bus.publish(makeEvent({ type: 'user', sessionId: 's1' }))
      expect(received).toHaveLength(1)
    })

    test('subscriberCount tracks active subscriptions', () => {
      expect(bus.subscriberCount()).toBe(0)
      const unsub1 = bus.subscribe(() => {})
      expect(bus.subscriberCount()).toBe(1)
      const unsub2 = bus.subscribe(() => {})
      expect(bus.subscriberCount()).toBe(2)
      unsub1()
      expect(bus.subscriberCount()).toBe(1)
      unsub2()
      expect(bus.subscriberCount()).toBe(0)
    })
  })

  describe('close', () => {
    test('clears subscribers and prevents publishing', () => {
      bus.subscribe(() => {})
      bus.close()
      expect(bus.subscriberCount()).toBe(0)
      expect(() => bus.publish(makeEvent({ type: 'user', sessionId: 's1' }))).toThrow()
    })
  })
})

describe('EventBus registry', () => {
  beforeEach(() => {
    for (const [key] of getAllEventBuses()) {
      removeEventBus(key)
    }
  })

  test('creates a new bus for an unknown session', () => {
    const bus = getEventBus('s1')
    expect(bus).toBeInstanceOf(EventBus)
    expect(getAllEventBuses().has('s1')).toBe(true)
  })

  test('returns the same bus for the same session', () => {
    expect(getEventBus('s1')).toBe(getEventBus('s1'))
  })

  test('removeEventBus removes and closes the bus', () => {
    const bus = getEventBus('s2')
    removeEventBus('s2')
    expect(getAllEventBuses().has('s2')).toBe(false)
    expect(() => bus.publish(makeEvent({ type: 'user', sessionId: 's2' }))).toThrow()
  })

  test('removeEventBus is a no-op for a missing bus', () => {
    expect(() => removeEventBus('nonexistent')).not.toThrow()
  })

  test('getAllEventBuses returns every registered bus', () => {
    getEventBus('a')
    getEventBus('b')
    expect(getAllEventBuses().size).toBeGreaterThanOrEqual(2)
  })
})

describe('publishSessionEvent', () => {
  beforeEach(() => {
    for (const [key] of getAllEventBuses()) {
      removeEventBus(key)
    }
  })

  test('persists the event before publishing it to the bus', async () => {
    const repos = createMemoryRepositories()
    const bus = getEventBus('s1')
    const received: SessionEvent[] = []
    bus.subscribe((event) => received.push(event))

    const event = await publishSessionEvent(repos, bus, 's1', 'assistant', { content: 'hello' }, 'inbound')

    const stored = await repos.events.listSince('s1', 0, 10)
    expect(stored).toHaveLength(1)
    expect(event.seqNum).toBe(stored[0]?.id)
    expect(event.id).toBe(stored[0]?.eventId)
    expect(event.createdAt).toBe(stored[0]?.createdAt.getTime())
    expect(received).toHaveLength(1)
    expect(received[0]).toBe(event)
  })

  test('publishes the normalized payload with raw preserved', async () => {
    const repos = createMemoryRepositories()
    const event = await publishSessionEvent(repos, getEventBus('s1'), 's1', 'assistant', { content: 'hi' }, 'inbound')

    const payload = event.payload as Record<string, unknown>
    expect(payload.content).toBe('hi')
    expect(payload.raw).toEqual({ content: 'hi' })
  })

  test('publishes even when no bus is supplied', async () => {
    const repos = createMemoryRepositories()
    const event = await publishSessionEvent(repos, null, 's1', 'user', { content: 'x' }, 'outbound')
    expect(event.seqNum).toBeGreaterThan(0)
    expect(await repos.events.listSince('s1', 0, 10)).toHaveLength(1)
  })
})

describe('publishInboundEvent', () => {
  test('drops a message whose uuid is already persisted', async () => {
    const repos = createMemoryRepositories()
    const first = await publishInboundEvent(repos, null, 's1', 'assistant', { uuid: 'a1' })
    expect(first).not.toBeNull()

    const echo = await publishInboundEvent(repos, null, 's1', 'assistant', { uuid: 'a1' })
    expect(echo).toBeNull()
    expect(await repos.events.listSince('s1', 0, 10)).toHaveLength(1)
  })

  test('drops a replay whose uuid was persisted outbound (a web prompt echo)', async () => {
    const repos = createMemoryRepositories()
    // The web composer persisted the prompt outbound; the bridge acks it inbound.
    const prompt = await publishSessionEvent(repos, null, 's1', 'user', { uuid: 'u1', content: 'hi' }, 'outbound')
    expect(prompt).not.toBeNull()

    expect(await publishInboundEvent(repos, null, 's1', 'user', { uuid: 'u1', content: 'hi' })).toBeNull()
    expect(await repos.events.listSince('s1', 0, 10)).toHaveLength(1)
  })

  test('never treats streaming deltas as message replays', async () => {
    const repos = createMemoryRepositories()
    // Stream chunks share the eventual assistant uuid but are distinct events.
    expect(await publishInboundEvent(repos, null, 's1', 'stream_event', { uuid: 'a1' })).not.toBeNull()
    expect(await publishInboundEvent(repos, null, 's1', 'partial_assistant', { uuid: 'a1' })).not.toBeNull()
    // The complete assistant message still persists after its deltas.
    expect(await publishInboundEvent(repos, null, 's1', 'assistant', { uuid: 'a1' })).not.toBeNull()

    // But a repeated complete message is dropped.
    expect(await publishInboundEvent(repos, null, 's1', 'assistant', { uuid: 'a1' })).toBeNull()
    expect(await repos.events.listSince('s1', 0, 10)).toHaveLength(3)
  })

  test('concurrent duplicate writes persist exactly one event', async () => {
    const repos = createMemoryRepositories()
    // Both pass the read-side check before either insert lands; the durable unique key must
    // still let only one through, or the next model request sees duplicate tool_use blocks.
    const results = await Promise.all([
      publishInboundEvent(repos, null, 's1', 'assistant', { uuid: 'race-1' }),
      publishInboundEvent(repos, null, 's1', 'assistant', { uuid: 'race-1' }),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await repos.events.listSince('s1', 0, 10)).toHaveLength(1)
  })

  test('persists events without a uuid every time', async () => {
    const repos = createMemoryRepositories()
    expect(await publishInboundEvent(repos, null, 's1', 'control_request', { request_id: 'r1' })).not.toBeNull()
    expect(await publishInboundEvent(repos, null, 's1', 'control_request', { request_id: 'r1' })).not.toBeNull()
    expect(await repos.events.listSince('s1', 0, 10)).toHaveLength(2)
  })
})

describe('AcpEventBus', () => {
  beforeEach(() => {
    for (const [key] of getAllAcpEventBuses()) removeAcpEventBus(key)
  })

  test('assigns monotonic seqNums and replays events after a cursor', () => {
    const bus = getAcpEventBus('group-1')
    const received: SessionEvent[] = []
    bus.subscribe((event) => received.push(event))

    const first = bus.publish({ id: 'a', sessionId: 'group-1', type: 'acp', payload: { n: 1 }, direction: 'outbound' })
    const second = bus.publish({ id: 'b', sessionId: 'group-1', type: 'acp', payload: { n: 2 }, direction: 'inbound' })

    expect(first.seqNum).toBe(1)
    expect(second.seqNum).toBe(2)
    expect(bus.getLastSeqNum()).toBe(2)
    expect(received).toHaveLength(2)
    expect(bus.getEventsSince(1).map((event) => event.id)).toEqual(['b'])
    expect(bus.getEventsSince(2)).toEqual([])
  })

  test('caps retained history and evicts the oldest half', () => {
    const bus = new AcpEventBus()
    for (let index = 0; index < 5001; index += 1) {
      bus.publish({ id: `e${index}`, sessionId: 'g', type: 'acp', payload: {}, direction: 'outbound' })
    }

    const retained = bus.getEventsSince(0)
    expect(retained).toHaveLength(2500)
    expect(retained[0]?.seqNum).toBe(2502)
    expect(bus.getLastSeqNum()).toBe(5001)
  })
})
