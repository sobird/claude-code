/**
 * Human-readable summaries for tool calls.
 *
 * Wire tool names carry the useful context in their input object (a Bash
 * command, a file path, a search pattern). The card header shows a one-line
 * summary and the expanded body shows only the fields that matter instead of
 * dumping the whole JSON blob. Unknown tools fall back to compact JSON.
 */

export interface ToolSummaryField {
  key: string
  value: string
}

export interface ToolSummary {
  /** Canonical wire name (legacy aliases resolved). */
  name: string
  /** One-line summary, clipped to the requested length. */
  summary: string
  /** Ordered subset of input fields worth showing in the card body. */
  fields: ToolSummaryField[]
  /** True when the tool is unknown and the summary is compact JSON. */
  fallback: boolean
}

const DEFAULT_MAX_LENGTH = 80
/** Field values are clipped separately so a huge prompt cannot blow up the card. */
const FIELD_MAX_LENGTH = 1200

/** Legacy/renamed wire tool names → the canonical name. */
const TOOL_ALIASES: Record<string, string> = {
  task: 'Agent',
}

export function canonicalToolName(name: string): string {
  const trimmed = name.trim().replace(/\s*\(.*\)$/, '')
  const alias = TOOL_ALIASES[trimmed.toLowerCase()]
  return alias ?? trimmed
}

/** 分组摘要用的短显示名；MCP 工具拆成 `tool · server`。 */
export function toolDisplayName(name: string): string {
  const mcp = parseMcpToolName(name)
  return mcp ? `${mcp.tool} · ${mcp.server}` : canonicalToolName(name)
}

export interface McpToolName {
  server: string
  tool: string
}

/**
 * 解析 `mcp__<server>__<tool>` 形式的限定名。按 `__` 切分：第一段必须是
 * `mcp`，第二段为 server，其余全部拼回 tool——与 CLI 的解析保持一致。
 */
export function parseMcpToolName(name: string): McpToolName | null {
  const parts = canonicalToolName(name).split('__')
  const [mcp, server, ...rest] = parts
  if (mcp !== 'mcp' || !server || rest.length === 0) return null
  const tool = rest.join('__')
  return tool ? { server, tool } : null
}

export function summarizeToolCall(
  name: string,
  input: Record<string, unknown> = {},
  maxLength = DEFAULT_MAX_LENGTH,
): ToolSummary {
  const canonical = canonicalToolName(name)
  const fields: ToolSummaryField[] = []
  let summary = ''

  const add = (key: string, value: unknown) => {
    const text = asText(value)
    if (text) fields.push({ key, value: clip(text, FIELD_MAX_LENGTH) })
  }

  switch (canonical) {
    case 'Bash':
      add('command', input.command)
      add('description', input.description)
      break
    case 'TaskOutput':
    case 'BashOutput':
    case 'AgentOutput':
    case 'BashOutputTool':
    case 'AgentOutputTool':
    case 'TaskStop':
    case 'KillShell':
      add('task_id', input.task_id ?? input.shell_id ?? input.bash_id)
      break
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      add('file_path', input.file_path ?? input.path)
      break
    case 'NotebookEdit':
      add('notebook_path', input.notebook_path ?? input.file_path)
      break
    case 'Glob':
      add('pattern', input.pattern)
      add('path', input.path)
      break
    case 'Grep':
      add('pattern', input.pattern)
      add('path', input.path)
      add('glob', input.glob)
      break
    case 'WebFetch':
      add('url', input.url)
      break
    case 'WebSearch':
      add('query', input.query)
      break
    case 'Agent':
      add('description', input.description)
      add('subagent_type', input.subagent_type)
      add('prompt', input.prompt)
      break
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? input.todos : []
      fields.push({ key: 'todos', value: String(todos.length) })
      summary = asText(asRecord(todos[0])?.content)
      break
    }
    case 'TaskCreate':
      add('subject', input.subject)
      add('description', input.description)
      break
    case 'TaskUpdate':
      add('taskId', input.taskId ?? input.task_id)
      add('status', input.status)
      break
    case 'AskUserQuestion': {
      const questions = Array.isArray(input.questions) ? input.questions : []
      questions.forEach((item, index) => {
        add(`question ${index + 1}`, asRecord(item)?.question)
      })
      summary = fields[0]?.value ?? ''
      break
    }
    case 'Brief':
      add('message', input.message)
      add('status', input.status)
      break
    case 'SendMessage':
      add('to', input.to)
      add('summary', input.summary)
      break
    case 'Skill':
      add('skill', input.skill ?? input.command)
      add('args', input.args)
      break
    default: {
      const mcp = parseMcpToolName(canonical)
      if (mcp) {
        return { name: mcp.tool, summary: clip(mcp.server, maxLength), fields: [], fallback: false }
      }
      const json = compactJson(input)
      return { name: canonical, summary: clip(json, maxLength), fields: [], fallback: true }
    }
  }

  if (!summary) summary = fields[0]?.value ?? ''
  return { name: canonical, summary: clip(summary, maxLength), fields, fallback: false }
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function compactJson(input: Record<string, unknown>): string {
  try {
    const json = JSON.stringify(input)
    return json === '{}' ? '' : json
  } catch {
    return ''
  }
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}
