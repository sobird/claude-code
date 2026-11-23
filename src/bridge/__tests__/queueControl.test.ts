import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import type { QueuedCommand } from '../../types/textInputTypes.js'
import { enqueue, getCommandQueue, resetCommandQueue } from '../../utils/messageQueueManager.js'
import { applyQueueUpdate } from '../queueControl.js'

type PromptCommand = QueuedCommand & { uuid: string }

function prompt(value: QueuedCommand['value'], extra: Partial<QueuedCommand> = {}): PromptCommand {
  return { value, mode: 'prompt', uuid: randomUUID(), skipSlashCommands: true, ...extra }
}

afterEach(() => {
  resetCommandQueue()
})

describe('applyQueueUpdate', () => {
  test('edit rewrites the row in place and returns the fresh queue', () => {
    const first = prompt('first', { priority: 'later' })
    const second = prompt('second', { priority: 'later' })
    enqueue(first)
    enqueue(second)

    const result = applyQueueUpdate({ action: 'edit', uuid: first.uuid, content: 'first (edited)' }, { canSteer: true })

    expect(result).toEqual({
      ok: true,
      queue: [
        { uuid: first.uuid, content: 'first (edited)', priority: 'later', editable: true },
        { uuid: second.uuid, content: 'second', priority: 'later', editable: true },
      ],
    })
    expect(getCommandQueue()[0]?.uuid).toBe(first.uuid)
  })

  test('edit rejects empty content', () => {
    const queued = prompt('keep me')
    enqueue(queued)
    expect(applyQueueUpdate({ action: 'edit', uuid: queued.uuid, content: '  ' }, { canSteer: true })).toEqual({
      ok: false,
      error: 'invalid-content',
    })
  })

  test('steer promotes priority and is refused while idle', () => {
    const queued = prompt('wait', { priority: 'later' })
    enqueue(queued)

    expect(applyQueueUpdate({ action: 'steer', uuid: queued.uuid }, { canSteer: false })).toEqual({
      ok: false,
      error: 'steer-unavailable',
    })
    expect(getCommandQueue()[0]?.priority).toBe('later')

    expect(applyQueueUpdate({ action: 'steer', uuid: queued.uuid }, { canSteer: true })).toEqual({
      ok: true,
      queue: [{ uuid: queued.uuid, content: 'wait', priority: 'next', editable: true }],
    })
  })

  test('remove drops the row; a second remove converges to queue-item-not-found', () => {
    const queued = prompt('remove me')
    enqueue(queued)

    expect(applyQueueUpdate({ action: 'remove', uuid: queued.uuid }, { canSteer: true })).toEqual({
      ok: true,
      queue: [],
    })
    expect(applyQueueUpdate({ action: 'remove', uuid: queued.uuid }, { canSteer: true })).toEqual({
      ok: false,
      error: 'queue-item-not-found',
    })
  })

  test('unknown uuids report queue-item-not-found', () => {
    expect(applyQueueUpdate({ action: 'edit', uuid: randomUUID(), content: 'x' }, { canSteer: true })).toEqual({
      ok: false,
      error: 'queue-item-not-found',
    })
    expect(applyQueueUpdate({ action: 'steer', uuid: randomUUID() }, { canSteer: true })).toEqual({
      ok: false,
      error: 'queue-item-not-found',
    })
  })
})
