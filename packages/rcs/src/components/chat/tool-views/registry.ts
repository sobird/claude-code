import type { ComponentType } from 'react'

import { BashToolView } from './BashToolView'
import { FileToolView } from './FileToolView'
import { QuestionToolView } from './QuestionToolView'
import { SearchToolView } from './SearchToolView'
import { TodoToolView } from './TodoToolView'
import type { ToolViewKind, ToolViewProps } from './types'
import { WebToolView } from './WebToolView'

/** 视图族 → 正文组件；卡片经 `toolViewKind` 选择，缺失时回退到通用正文。 */
export const TOOL_VIEWS: Readonly<Partial<Record<ToolViewKind, ComponentType<ToolViewProps>>>> = {
  bash: BashToolView,
  file: FileToolView,
  search: SearchToolView,
  web: WebToolView,
  todo: TodoToolView,
  question: QuestionToolView,
}
