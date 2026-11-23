import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import type { QueuedCommand } from '../../types/textInputTypes.js'
import {
  enqueue,
  getBridgeQueueSnapshot,
  getCommandQueue,
  resetCommandQueue,
  updateQueuedCommand,
} from '../messageQueueManager.js'

type PromptCommand = QueuedCommand & { uuid: string }

function prompt(value: QueuedCommand['value'], extra: Partial<QueuedCommand> = {}): PromptCommand {
  return { value, mode: 'prompt', uuid: randomUUID(), skipSlashCommands: true, ...extra }
}

afterEach(() => {
  resetCommandQueue()
})

describe('updateQueuedCommand', () => {
  test('edits the text in place, keeping uuid, priority, and position', () => {
    const first = prompt('first')
    const second = prompt('second', { priority: 'later' })
    enqueue(first)
    enqueue(second)

    expect(updateQueuedCommand(first.uuid, { value: 'first edited' })).toBe(true)

    const queue = getCommandQueue()
    expect(queue.map((cmd) => cmd.uuid)).toEqual([first.uuid, second.uuid])
    expect(queue[0]?.value).toBe('first edited')
    expect(queue[0]?.priority).toBe('next')
    expect(queue[1]?.priority).toBe('later')
  })

  test('steering only promotes the priority, it does not move the item', () => {
    const queued = prompt('wait for the turn', { priority: 'later' })
    enqueue(queued)

    expect(updateQueuedCommand(queued.uuid, { priority: 'next' })).toBe(true)
    expect(getCommandQueue()[0]?.priority).toBe('next')
    expect(getCommandQueue()[0]?.uuid).toBe(queued.uuid)
  })

  test('returns false for an unknown uuid', () => {
    enqueue(prompt('hello'))
    expect(updateQueuedCommand(randomUUID(), { value: 'nope' })).toBe(false)
  })

  test('refuses to rewrite a command whose content is block-based (attachments)', () => {
    const withImage = prompt([{ type: 'text', text: 'look at this' }])
    enqueue(withImage)

    expect(updateQueuedCommand(withImage.uuid, { value: 'replace' })).toBe(false)
    expect(getCommandQueue()[0]?.value).toEqual([{ type: 'text', text: 'look at this' }])
  })

  test('refuses non-editable system commands', () => {
    const notification = prompt('task done', { mode: 'task-notification' })
    enqueue(notification)
    expect(updateQueuedCommand(notification.uuid, { value: 'nope' })).toBe(false)
  })
})

describe('getBridgeQueueSnapshot', () => {
  test('lists editable prompts with uuid, text, priority, and editability', () => {
    const text = prompt('plain')
    const image = prompt([{ type: 'text', text: 'caption' }], { priority: 'later' })
    enqueue(text)
    enqueue(image)
    enqueue(prompt('system note', { mode: 'task-notification' }))
    enqueue({ value: 'no uuid', mode: 'prompt' })

    expect(getBridgeQueueSnapshot()).toEqual([
      { uuid: text.uuid, content: 'plain', priority: 'next', editable: true },
      { uuid: image.uuid, content: 'caption', priority: 'later', editable: false },
    ])
  })
})
