import { describe, expect, test } from 'bun:test'

import {
  buildStopTaskRequest,
  completeBackgroundTask,
  elapsedMs,
  progressBackgroundTask,
  sanitizeTaskUsage,
  startBackgroundTask,
  type BackgroundTask,
} from '../background-tasks'

describe('sanitizeTaskUsage', () => {
  test('maps the snake_case SDK usage onto a finite non-negative shape', () => {
    expect(sanitizeTaskUsage({ total_tokens: 1200, tool_uses: 4, duration_ms: 90_000 })).toEqual({
      totalTokens: 1200,
      toolUses: 4,
      durationMs: 90_000,
    })
  })

  test('drops invalid and extra fields, defaulting missing ones to zero', () => {
    expect(sanitizeTaskUsage({ total_tokens: Number.NaN, tool_uses: -1, duration_ms: 5, secret: 'x' })).toEqual({
      totalTokens: 0,
      toolUses: 0,
      durationMs: 5,
    })
  })

  test('returns null for non-objects and fields-only junk', () => {
    expect(sanitizeTaskUsage(null)).toBeNull()
    expect(sanitizeTaskUsage('usage')).toBeNull()
    expect(sanitizeTaskUsage({ secret: 'x' })).toBeNull()
  })

  test('accepts the already-normalized camelCase counters the reducer receives', () => {
    expect(sanitizeTaskUsage({ totalTokens: 1200, toolUses: 4, durationMs: 90_000 })).toEqual({
      totalTokens: 1200,
      toolUses: 4,
      durationMs: 90_000,
    })
  })
})

function startPayload(taskId: string, description = 'Review auth'): Record<string, unknown> {
  return { subtype: 'task_started', task_id: taskId, description, task_type: 'local_agent', tool_use_id: 'call-1' }
}

function progressPayload(taskId: string): Record<string, unknown> {
  return {
    subtype: 'task_progress',
    task_id: taskId,
    description: 'Reviewing',
    usage: { total_tokens: 900, tool_uses: 3, duration_ms: 12_000 },
    last_tool_name: 'Read',
    summary: 'halfway',
  }
}

describe('startBackgroundTask', () => {
  test('records a running task with the event time as its start', () => {
    const tasks = startBackgroundTask([], startPayload('t1'), 1_000)
    expect(tasks).toEqual([
      {
        taskId: 't1',
        description: 'Review auth',
        taskType: 'local_agent',
        toolUseId: 'call-1',
        startedAt: 1_000,
      },
    ])
  })

  test('upserts by task id instead of duplicating and keeps the first start time', () => {
    const first = startBackgroundTask([], startPayload('t1'), 1_000)
    const replayed = startBackgroundTask(first, startPayload('t1', 'Review auth v2'), 2_000)
    expect(replayed).toHaveLength(1)
    expect(replayed[0]?.description).toBe('Review auth v2')
    expect(replayed[0]?.startedAt).toBe(1_000)
  })

  test('preserves insertion order across different tasks', () => {
    const tasks = startBackgroundTask(startBackgroundTask([], startPayload('t1'), 1), startPayload('t2'), 2)
    expect(tasks.map((task) => task.taskId)).toEqual(['t1', 't2'])
  })

  test('ignores payloads without a task id', () => {
    const previous: BackgroundTask[] = []
    expect(startBackgroundTask(previous, { subtype: 'task_started' }, 1)).toBe(previous)
  })
})

describe('progressBackgroundTask', () => {
  test('merges usage and the last tool into the known task', () => {
    const started = startBackgroundTask([], startPayload('t1'), 1_000)
    const tasks = progressBackgroundTask(started, progressPayload('t1'), 5_000)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      taskId: 't1',
      description: 'Reviewing',
      startedAt: 1_000,
      lastToolName: 'Read',
      summary: 'halfway',
      usage: { totalTokens: 900, toolUses: 3, durationMs: 12_000 },
    })
  })

  test('creates a placeholder when progress outruns its start (truncated history)', () => {
    const tasks = progressBackgroundTask([], progressPayload('t9'), 7_000)
    expect(tasks).toEqual([expect.objectContaining({ taskId: 't9', description: 'Reviewing', startedAt: 7_000 })])
  })

  test('ignores payloads without a task id', () => {
    const previous = startBackgroundTask([], startPayload('t1'), 1_000)
    expect(progressBackgroundTask(previous, { subtype: 'task_progress' }, 2_000)).toBe(previous)
  })
})

describe('completeBackgroundTask', () => {
  test('removes only the matching task', () => {
    const tasks = startBackgroundTask(startBackgroundTask([], startPayload('t1'), 1), startPayload('t2'), 2)
    const remaining = completeBackgroundTask(tasks, 't1')
    expect(remaining.map((task) => task.taskId)).toEqual(['t2'])
  })

  test('is a no-op for unknown or missing ids', () => {
    const tasks = startBackgroundTask([], startPayload('t1'), 1)
    expect(completeBackgroundTask(tasks, 'nope')).toBe(tasks)
    expect(completeBackgroundTask(tasks, '')).toBe(tasks)
  })
})

describe('buildStopTaskRequest', () => {
  test('wraps the task id in the stop_task control envelope', () => {
    expect(buildStopTaskRequest('req-1', 'task-9')).toEqual({
      type: 'control_request',
      request_id: 'req-1',
      request: { subtype: 'stop_task', task_id: 'task-9' },
    })
  })
})

describe('elapsedMs', () => {
  test('measures from the recorded start and clamps clock skew', () => {
    expect(elapsedMs({ taskId: 't', description: '', startedAt: 1_000 }, 4_500)).toBe(3_500)
    expect(elapsedMs({ taskId: 't', description: '', startedAt: 5_000 }, 4_000)).toBe(0)
  })

  test('returns null without a start time', () => {
    expect(elapsedMs({ taskId: 't', description: '', startedAt: null }, 1_000)).toBeNull()
  })
})
