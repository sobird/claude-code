import type { ComponentType } from 'react'

import { canonicalToolName } from '@/lib/tool-summary'

import { AgentToolView } from './AgentToolView'
import { BackgroundTaskToolView } from './BackgroundTaskToolView'
import { BashToolView } from './BashToolView'
import { FileToolView } from './FileToolView'
import { McpToolView } from './McpToolView'
import { MessageToolView } from './MessageToolView'
import { QuestionToolView } from './QuestionToolView'
import { SearchToolView } from './SearchToolView'
import { SkillToolView } from './SkillToolView'
import { TaskToolView } from './TaskToolView'
import { TodoToolView } from './TodoToolView'
import type { ToolViewKind, ToolViewProps } from './types'
import { WebToolView } from './WebToolView'

interface ToolViewDefinition {
  kind: ToolViewKind
  /** 归入该视图族的规范工具名（经 `canonicalToolName` 归一后匹配）。 */
  tools: readonly string[]
  /** 按名称前缀归入该族（如全部 `mcp__` 工具）；精确名未命中时兜底。 */
  prefix?: string
  component: ComponentType<ToolViewProps>
}

/**
 * 工具名 → 正文视图的唯一落点。新增视图：在 types.ts 拓宽 `ToolViewKind`，
 * 在此追加一条定义，编写组件 + model + 测试；`toolViewKind` 与 `TOOL_VIEWS`
 * 都由这张表派生，不再分别维护。未登记的工具回退到通用正文。
 */
const TOOL_VIEW_DEFINITIONS: readonly ToolViewDefinition[] = [
  { kind: 'bash', tools: ['Bash'], component: BashToolView },
  { kind: 'file', tools: ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'], component: FileToolView },
  { kind: 'search', tools: ['Grep', 'Glob'], component: SearchToolView },
  { kind: 'web', tools: ['WebFetch', 'WebSearch'], component: WebToolView },
  { kind: 'agent', tools: ['Agent'], component: AgentToolView },
  { kind: 'task', tools: ['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'], component: TaskToolView },
  {
    kind: 'background',
    tools: ['TaskOutput', 'AgentOutputTool', 'BashOutputTool', 'BashOutput', 'TaskStop', 'KillShell'],
    component: BackgroundTaskToolView,
  },
  { kind: 'skill', tools: ['Skill'], component: SkillToolView },
  { kind: 'message', tools: ['Brief', 'SendMessage'], component: MessageToolView },
  { kind: 'mcp', tools: [], prefix: 'mcp__', component: McpToolView },
  { kind: 'todo', tools: ['TodoWrite'], component: TodoToolView },
  { kind: 'question', tools: ['AskUserQuestion'], component: QuestionToolView },
]

const KIND_BY_TOOL = new Map<string, ToolViewKind>(
  TOOL_VIEW_DEFINITIONS.flatMap((definition) => definition.tools.map((tool) => [tool, definition.kind] as const)),
)

const KIND_BY_PREFIX = TOOL_VIEW_DEFINITIONS.flatMap((definition) =>
  definition.prefix ? [[definition.prefix, definition.kind] as const] : [],
)

/** 返回工具应使用的正文视图族，未知工具返回 `null`。 */
export function toolViewKind(name: string): ToolViewKind | null {
  const canonical = canonicalToolName(name)
  const exact = KIND_BY_TOOL.get(canonical)
  if (exact) return exact
  const prefixed = KIND_BY_PREFIX.find(([prefix]) => canonical.startsWith(prefix))
  return prefixed?.[1] ?? null
}

/** 视图族 → 正文组件。 */
export const TOOL_VIEWS: Readonly<Partial<Record<ToolViewKind, ComponentType<ToolViewProps>>>> = Object.fromEntries(
  TOOL_VIEW_DEFINITIONS.map((definition) => [definition.kind, definition.component]),
)
