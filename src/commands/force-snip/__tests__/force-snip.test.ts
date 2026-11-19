import { describe, expect, test } from 'bun:test'

import type { LocalJSXCommandContext } from '../../../types/command.js'
import type { Message } from '../../../types/message.js'
import { formatForceSnipResult, forceSnip } from '../force-snip.js'
import forceSnipCommand from '../index.js'

function userMessage(uuid: string): Message {
  return {
    type: 'user',
    uuid,
    timestamp: '2026-11-20T12:00:00.000Z',
    message: { role: 'user', content: 'hi' },
  } as unknown as Message
}

function markerMessage(uuid: string, removedUuids: string[]): Message {
  return {
    type: 'system',
    subtype: 'info',
    content: '',
    isMeta: false,
    timestamp: '2026-11-20T12:00:00.000Z',
    uuid,
    message: { role: 'system', content: '' },
    snapshotFiles: [],
    snipMarker: { removedUuids },
  } as unknown as Message
}

describe('/force-snip', () => {
  test('applies pending snip markers and drops the removed messages', () => {
    const result = forceSnip([userMessage('keep-me'), userMessage('remove-me'), markerMessage('marker', ['remove-me'])])

    expect(result.executed).toBe(true)
    const uuids: string[] = result.messages.map((message) => message.uuid)
    expect(uuids).toContain('keep-me')
    expect(uuids).not.toContain('remove-me')
    expect(uuids).not.toContain('marker')
    const boundary = result.messages.at(-1)
    expect(boundary?.type).toBe('system')
    expect(boundary?.subtype).toBe('snip_boundary')
    expect(formatForceSnipResult(result)).toContain('tokens freed')
  })

  test('is a no-op when there are no markers to apply', () => {
    const messages = [userMessage('a')]
    const result = forceSnip(messages)

    expect(result.executed).toBe(false)
    expect(result.messages).toBe(messages)
    expect(formatForceSnipResult(result)).toContain('Nothing to snip')
  })

  test('call() writes the snipped messages back through setMessages', async () => {
    const messages = [userMessage('a'), markerMessage('marker', ['a'])]
    let written: Message[] | undefined
    const context = {
      messages,
      setMessages: (updater: (prev: Message[]) => Message[]) => {
        written = updater(messages)
      },
    } as unknown as LocalJSXCommandContext

    const { call } = await forceSnipCommand.load()
    const result = await call('', context)

    expect(result.type).toBe('text')
    expect(written).toBeDefined()
    expect(written?.some((message) => (message.uuid as string) === 'a')).toBe(false)
  })

  test('registers as /force-snip', () => {
    expect(forceSnipCommand.name).toBe('force-snip')
    expect(forceSnipCommand.type).toBe('local')
    expect(forceSnipCommand.description).toContain('snip')
  })
})
