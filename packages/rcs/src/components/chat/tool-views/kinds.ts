import { canonicalToolName } from '@/lib/tool-summary'

import type { ToolViewKind } from './types'

/** 规范工具名 → 正文视图族；未登记的工具走通用正文。 */
const BY_NAME: Readonly<Partial<Record<string, ToolViewKind>>> = {
  Bash: 'bash',
  Read: 'file',
  Write: 'file',
  Edit: 'file',
  MultiEdit: 'file',
  NotebookEdit: 'file',
  Grep: 'search',
  Glob: 'search',
  WebFetch: 'web',
  WebSearch: 'web',
  TodoWrite: 'todo',
  AskUserQuestion: 'question',
}

/** 返回工具应使用的正文视图族，未知工具返回 `null`。 */
export function toolViewKind(name: string): ToolViewKind | null {
  return BY_NAME[canonicalToolName(name)] ?? null
}
