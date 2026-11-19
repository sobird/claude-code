import { describe, expect, test } from 'bun:test'

import {
  LineDecoder,
  StderrTail,
  encodeInterrupt,
  encodePermissionResponse,
  encodeUserMessage,
  parseStdoutLine,
} from '../protocol.js'

describe('encodeUserMessage', () => {
  test('wraps content in an SDK user message frame', () => {
    const frame = JSON.parse(encodeUserMessage('hello world', 'sess-1'))
    expect(frame.type).toBe('user')
    expect(frame.message).toEqual({ role: 'user', content: 'hello world' })
    expect(frame.parent_tool_use_id).toBeNull()
    expect(frame.session_id).toBe('sess-1')
  })

  test('omits session_id when not provided and ends with a newline', () => {
    const raw = encodeUserMessage([{ type: 'text', text: 'hi' }])
    expect(raw.endsWith('\n')).toBe(true)
    const frame = JSON.parse(raw)
    expect(frame.session_id).toBeUndefined()
    expect(frame.message.content).toEqual([{ type: 'text', text: 'hi' }])
  })
})

describe('encodeInterrupt', () => {
  test('emits an interrupt control request', () => {
    const frame = JSON.parse(encodeInterrupt('req-9'))
    expect(frame).toEqual({
      type: 'control_request',
      request_id: 'req-9',
      request: { subtype: 'interrupt' },
    })
  })
})

describe('encodePermissionResponse', () => {
  test('allow carries updatedInput', () => {
    const frame = JSON.parse(encodePermissionResponse('req-1', { behavior: 'allow', updatedInput: { command: 'ls' } }))
    expect(frame).toEqual({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'req-1',
        response: { behavior: 'allow', updatedInput: { command: 'ls' } },
      },
    })
  })

  test('deny carries message', () => {
    const frame = JSON.parse(encodePermissionResponse('req-2', { behavior: 'deny', message: 'no' }))
    expect(frame.response.response).toEqual({ behavior: 'deny', message: 'no' })
  })
})

describe('parseStdoutLine', () => {
  test('parses a valid JSON object', () => {
    const parsed = parseStdoutLine('{"type":"result","subtype":"success"}') as {
      type: string
      subtype?: string
    } | null
    expect(parsed).toEqual({ type: 'result', subtype: 'success' })
  })

  test('ignores blank and malformed lines', () => {
    expect(parseStdoutLine('')).toBeNull()
    expect(parseStdoutLine('not json')).toBeNull()
    expect(parseStdoutLine('[1,2,3]')).toBeNull()
  })
})

describe('LineDecoder', () => {
  test('emits complete lines and buffers the remainder', () => {
    const decoder = new LineDecoder()
    expect(decoder.push('one\ntwo')).toEqual(['one'])
    expect(decoder.push(' three\n')).toEqual(['two three'])
  })

  test('drops a trailing empty line and handles CRLF', () => {
    const decoder = new LineDecoder()
    expect(decoder.push('a\r\nb\r\n')).toEqual(['a', 'b'])
  })

  test('flush returns any buffered remainder', () => {
    const decoder = new LineDecoder()
    decoder.push('partial')
    expect(decoder.flush()).toBe('partial')
  })
})

describe('StderrTail', () => {
  test('returns the most recent text within the byte budget', () => {
    const tail = new StderrTail(10)
    tail.push('0123456789')
    tail.push('abc')
    expect(tail.get().endsWith('abc')).toBe(true)
    expect(tail.get().length).toBeLessThanOrEqual(13)
  })

  test('starts empty', () => {
    expect(new StderrTail(64).get()).toBe('')
  })
})
