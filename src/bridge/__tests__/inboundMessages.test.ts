import { describe, expect, test } from 'bun:test'

import { inboundDeliveryOf, queuePriorityOf } from '../inboundMessages.js'

describe('inboundDeliveryOf', () => {
  test('reads an explicit queue lane', () => {
    expect(inboundDeliveryOf({ type: 'user', delivery: 'queue' })).toBe('queue')
  })

  test('treats steer and missing fields as steering', () => {
    expect(inboundDeliveryOf({ type: 'user', delivery: 'steer' })).toBe('steer')
    expect(inboundDeliveryOf({ type: 'user' })).toBe('steer')
    expect(inboundDeliveryOf(null)).toBe('steer')
    expect(inboundDeliveryOf('user')).toBe('steer')
  })

  test('ignores non-string delivery values', () => {
    expect(inboundDeliveryOf({ delivery: 1 })).toBe('steer')
    expect(inboundDeliveryOf({ delivery: null })).toBe('steer')
  })
})

describe('queuePriorityOf', () => {
  test('maps lanes to CLI queue priorities', () => {
    expect(queuePriorityOf('queue')).toBe('later')
    expect(queuePriorityOf('steer')).toBe('next')
  })
})
