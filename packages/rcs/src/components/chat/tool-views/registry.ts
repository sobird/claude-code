import type { ComponentType } from 'react'

import { canonicalToolName } from '@/lib/tool-summary'

import { AgentToolView } from './AgentToolView'
import { BashToolView } from './BashToolView'
import { FileToolView } from './FileToolView'
import { QuestionToolView } from './QuestionToolView'
import { SearchToolView } from './SearchToolView'
import { TaskToolView } from './TaskToolView'
import { TodoToolView } from './TodoToolView'
import type { ToolViewKind, ToolViewProps } from './types'
import { WebToolView } from './WebToolView'

interface ToolViewDefinition {
  kind: ToolViewKind
  /** 归入该视图族的规范工具名（经 `canonicalToolName` 归一后匹配）。 */
  tools: readonly string[]
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
  { kind: 'todo', tools: ['TodoWrite'], component: TodoToolView },
  { kind: 'question', tools: ['AskUserQuestion'], component: QuestionToolView },
]

const KIND_BY_TOOL = new Map<string, ToolViewKind>(
  TOOL_VIEW_DEFINITIONS.flatMap((definition) => definition.tools.map((tool) => [tool, definition.kind] as const)),
)

/** 返回工具应使用的正文视图族，未知工具返回 `null`。 */
export function toolViewKind(name: string): ToolViewKind | null {
  return KIND_BY_TOOL.get(canonicalToolName(name)) ?? null
}

/** 视图族 → 正文组件。 */
export const TOOL_VIEWS: Readonly<Partial<Record<ToolViewKind, ComponentType<ToolViewProps>>>> = Object.fromEntries(
  TOOL_VIEW_DEFINITIONS.map((definition) => [definition.kind, definition.component]),
)
