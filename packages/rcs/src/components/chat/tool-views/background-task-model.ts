/**
 * 后台任务工具族正文：TaskOutput 的读取结果与 TaskStop 的终止结果。
 *
 * 结果形状见 CLI `src/tools/TaskOutputTool/TaskOutputTool.tsx` 的
 * `mapToolResultToToolResultBlockParam`（标签块）与 `TaskStopTool.ts`
 * （成功时是 JSON，校验失败时是纯文本）。解析不出内容时返回 `null`，
 * 由调用方退回通用正文。
 */

import type { ToolCallData } from '@/lib/session-reducer'

import { formatOutput } from './format'

export type TaskRunStatus = 'running' | 'pending' | 'completed' | 'failed' | 'stopped' | 'killed'
export type RetrievalStatus = 'success' | 'timeout' | 'not_ready'

export type BackgroundTaskViewModel =
  | {
      kind: 'output'
      taskId: string | null
      taskType: string | null
      status: TaskRunStatus | null
      retrieval: RetrievalStatus | null
      exitCode: number | null
      output: string | null
      error: string | null
    }
  | {
      kind: 'stop'
      taskId: string | null
      taskType: string | null
      command: string | null
      message: string | null
      stopped: boolean
    }
  | { kind: 'message'; text: string }

/** `TaskOutput` 及历史别名；别名不会经 `canonicalToolName` 归一。 */
const OUTPUT_TOOLS = new Set(['TaskOutput', 'AgentOutputTool', 'BashOutputTool', 'BashOutput'])
const STOP_TOOLS = new Set(['TaskStop', 'KillShell'])

const RUN_STATUSES: readonly TaskRunStatus[] = ['running', 'pending', 'completed', 'failed', 'stopped', 'killed']
const RETRIEVAL_STATUSES: readonly RetrievalStatus[] = ['success', 'timeout', 'not_ready']
const EXIT_CODE = /<exit_code>(-?\d+)<\/exit_code>/

export function backgroundTaskViewModel(tool: ToolCallData): BackgroundTaskViewModel | null {
  const name = tool.title.trim().replace(/\s*\(.*\)$/, '')
  const input = tool.rawInput ?? {}
  const output = formatOutput(tool).trim()
  if (OUTPUT_TOOLS.has(name)) return outputModel(input, output)
  if (STOP_TOOLS.has(name)) return stopModel(input, output)
  return null
}

function outputModel(input: Record<string, unknown>, output: string): BackgroundTaskViewModel | null {
  const inputId = text(input.task_id)
  if (!output) return inputId ? emptyOutput(inputId) : null
  if (!tag('retrieval_status', output)) return { kind: 'message', text: output }
  return {
    kind: 'output',
    taskId: tag('task_id', output) ?? inputId,
    taskType: tag('task_type', output),
    status: runStatusOf(tag('status', output)),
    retrieval: retrievalOf(tag('retrieval_status', output)),
    exitCode: exitCodeOf(output),
    output: tag('output', output),
    error: tag('error', output),
  }
}

function emptyOutput(taskId: string): BackgroundTaskViewModel {
  return {
    kind: 'output',
    taskId,
    taskType: null,
    status: null,
    retrieval: null,
    exitCode: null,
    output: null,
    error: null,
  }
}

function stopModel(input: Record<string, unknown>, output: string): BackgroundTaskViewModel | null {
  const inputId = text(input.task_id) ?? text(input.shell_id)
  if (!output) {
    return inputId
      ? { kind: 'stop', taskId: inputId, taskType: null, command: null, message: null, stopped: false }
      : null
  }
  const payload = parseJsonRecord(output)
  if (!payload) return { kind: 'message', text: output }
  const taskId = text(payload.task_id) ?? inputId
  if (!taskId) return { kind: 'message', text: text(payload.message) ?? output }
  return {
    kind: 'stop',
    taskId,
    taskType: text(payload.task_type),
    command: text(payload.command),
    message: text(payload.message),
    stopped: true,
  }
}

/** 取第一个 `<tag>…</tag>` 的非空内容；标签本身来自常量，不拼接外部输入。 */
function tag(name: string, output: string): string | null {
  const match = output.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))
  const value = match?.[1]?.trim()
  return value ? value : null
}

function exitCodeOf(output: string): number | null {
  const match = output.match(EXIT_CODE)
  return match ? Number(match[1]) : null
}

function runStatusOf(value: string | null): TaskRunStatus | null {
  return RUN_STATUSES.find((status) => status === value) ?? null
}

function retrievalOf(value: string | null): RetrievalStatus | null {
  return RETRIEVAL_STATUSES.find((status) => status === value) ?? null
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  if (!value.startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}
