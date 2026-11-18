import { describe, expect, test } from 'bun:test'

import { normalizePayload } from '../event-bus.js'

// extractContent is not exported; we test it via normalizePayload's content field

// =============================================================================
// extractContent (via normalizePayload content field)
// =============================================================================

describe('extractContent', () => {
  test('returns empty string for null payload', () => {
    expect(normalizePayload('assistant', null).content).toBe('')
  })

  test('returns empty string for undefined payload', () => {
    expect(normalizePayload('assistant', undefined).content).toBe('')
  })

  test('returns the string for string payload', () => {
    expect(normalizePayload('assistant', 'hello world').content).toBe('hello world')
  })

  test('extracts content field from object payload', () => {
    expect(normalizePayload('assistant', { content: 'direct content' }).content).toBe('direct content')
  })

  test('extracts message.content string from object payload', () => {
    expect(normalizePayload('assistant', { message: { content: 'msg content' } }).content).toBe('msg content')
  })

  test('extracts text blocks from message.content array', () => {
    const payload = {
      message: {
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'World' },
        ],
      },
    }
    expect(normalizePayload('assistant', payload).content).toBe('Hello World')
  })

  test('ignores non-text blocks in message.content array', () => {
    const payload = {
      message: {
        content: [
          { type: 'image', url: 'http://example.com/img.png' },
          { type: 'text', text: 'only this' },
        ],
      },
    }
    expect(normalizePayload('assistant', payload).content).toBe('only this')
  })

  test('returns empty string when no extractable content', () => {
    expect(normalizePayload('assistant', { foo: 'bar' }).content).toBe('')
  })

  test('prefers direct content over message.content', () => {
    expect(normalizePayload('assistant', { content: 'direct', message: { content: 'nested' } }).content).toBe('direct')
  })
})

// =============================================================================
// normalizePayload — field preservation
// =============================================================================

describe('normalizePayload — field preservation', () => {
  test('preserves raw payload', () => {
    const payload = { content: 'test', extra: true }
    expect(normalizePayload('assistant', payload).raw).toBe(payload)
  })

  test('preserves uuid field', () => {
    expect(normalizePayload('assistant', { uuid: 'u-123' }).uuid).toBe('u-123')
  })

  test('does not preserve uuid when empty string', () => {
    expect(normalizePayload('assistant', { uuid: '' }).uuid).toBeUndefined()
  })

  test('preserves isSynthetic boolean', () => {
    expect(normalizePayload('assistant', { isSynthetic: true }).isSynthetic).toBe(true)
  })

  test('preserves status string', () => {
    expect(normalizePayload('assistant', { status: 'running' }).status).toBe('running')
  })

  test('preserves subtype string', () => {
    expect(normalizePayload('assistant', { subtype: 'progress' }).subtype).toBe('progress')
  })

  test('preserves tool_name from tool_name field', () => {
    expect(normalizePayload('tool', { tool_name: 'bash' }).tool_name).toBe('bash')
  })

  test('preserves tool_name from name field', () => {
    expect(normalizePayload('tool', { name: 'read' }).tool_name).toBe('read')
  })

  test('preserves tool_input from tool_input field', () => {
    const input = { command: 'ls' }
    expect(normalizePayload('tool', { tool_input: input }).tool_input).toEqual(input)
  })

  test('preserves tool_input from input field', () => {
    const input = { path: '/tmp' }
    expect(normalizePayload('tool', { input }).tool_input).toEqual(input)
  })

  test('preserves request_id', () => {
    expect(normalizePayload('permission', { request_id: 'req-1' }).request_id).toBe('req-1')
  })

  test('preserves request object', () => {
    const request = { subtype: 'permission' }
    expect(normalizePayload('permission', { request }).request).toEqual(request)
  })

  test('preserves approved field', () => {
    expect(normalizePayload('permission', { approved: true }).approved).toBe(true)
  })

  test('preserves updated_input', () => {
    const input = { command: 'rm -rf' }
    expect(normalizePayload('permission', { updated_input: input }).updated_input).toEqual(input)
  })

  test('preserves updated_permissions', () => {
    const permissions = [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]
    expect(normalizePayload('permission', { updated_permissions: permissions }).updated_permissions).toEqual(
      permissions,
    )
  })

  test('preserves the control_response response envelope', () => {
    const response = { subtype: 'success', request_id: 'req-1', response: { mode: 'plan' } }
    expect(normalizePayload('control_response', { response }).response).toEqual(response)
  })

  test('preserves message field for backward compat', () => {
    const message = { role: 'user', content: 'hi' }
    expect(normalizePayload('assistant', { message }).message).toEqual(message)
  })
})

// =============================================================================
// normalizePayload — task_state special handling
// =============================================================================

describe('normalizePayload — task_state type', () => {
  test('preserves task_list_id (snake_case)', () => {
    expect(normalizePayload('task_state', { task_list_id: 'tl-1' }).task_list_id).toBe('tl-1')
  })

  test('preserves taskListId (camelCase)', () => {
    expect(normalizePayload('task_state', { taskListId: 'tl-2' }).taskListId).toBe('tl-2')
  })

  test('preserves tasks array', () => {
    const tasks = [{ id: 't1', title: 'Task 1' }]
    expect(normalizePayload('task_state', { tasks }).tasks).toEqual(tasks)
  })

  test('does not preserve task fields for non-task_state type', () => {
    const result = normalizePayload('assistant', { task_list_id: 'tl-1', taskListId: 'tl-2', tasks: [] })
    expect(result.task_list_id).toBeUndefined()
    expect(result.taskListId).toBeUndefined()
    expect(result.tasks).toBeUndefined()
  })
})

// =============================================================================
// normalizePayload — system task lifecycle fields
// =============================================================================

describe('normalizePayload — system task fields', () => {
  test('lifts the task lifecycle fields out of raw', () => {
    const result = normalizePayload('system', {
      subtype: 'task_progress',
      task_id: 't1',
      tool_use_id: 'call-1',
      description: 'Reviewing',
      task_type: 'local_agent',
      status: 'running',
      summary: 'halfway',
      last_tool_name: 'Read',
      usage: { total_tokens: 1200, tool_uses: 4, duration_ms: 90_000 },
    })

    expect(result).toMatchObject({
      task_id: 't1',
      tool_use_id: 'call-1',
      description: 'Reviewing',
      task_type: 'local_agent',
      status: 'running',
      summary: 'halfway',
      last_tool_name: 'Read',
      usage: { totalTokens: 1200, toolUses: 4, durationMs: 90_000 },
    })
  })

  test('sanitizes the usage counters', () => {
    expect(normalizePayload('system', { usage: { total_tokens: -1, tool_uses: 3, duration_ms: 5 } }).usage).toEqual({
      totalTokens: 0,
      toolUses: 3,
      durationMs: 5,
    })
    expect(normalizePayload('system', { usage: 'junk' }).usage).toBeUndefined()
  })

  test('lifts session_state_changed state', () => {
    expect(normalizePayload('system', { subtype: 'session_state_changed', state: 'idle' }).state).toBe('idle')
  })

  test('does not lift system task fields for other event types', () => {
    const result = normalizePayload('assistant', { task_id: 't1', state: 'idle', last_tool_name: 'Read' })
    expect(result.task_id).toBeUndefined()
    expect(result.state).toBeUndefined()
    expect(result.last_tool_name).toBeUndefined()
  })
})
