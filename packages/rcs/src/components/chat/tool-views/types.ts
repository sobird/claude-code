/**
 * 工具卡片正文视图的共享类型。
 *
 * 视图只替换卡片正文；标题摘要、相邻工具分组、折叠、键盘光标与子代理嵌套
 * 仍由 `ToolCallGroup` 负责，这样新增视图不会改变既有交互。
 */

import type { ToolCallData } from '@/lib/session-reducer'

/** 正文视图族；同一族的工具共用一套渲染。 */
export type ToolViewKind = 'bash' | 'file' | 'search' | 'web' | 'todo' | 'question' | 'agent' | 'task'

export interface ToolViewProps {
  tool: ToolCallData
}
