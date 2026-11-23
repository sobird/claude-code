import type { ToolCallData } from '@/lib/session-reducer'
import { diffLines, toolEditPreview, type EditPreviewHunk } from '@/lib/text-diff'

import { firstString, formatOutput } from './format'

export interface FileViewModel {
  path: string
  /** 编辑类工具的旧/新片段；`null` 表示展示原始文件内容或输出。 */
  hunks: EditPreviewHunk[] | null
  output: string
  errored: boolean
}

/** 汇总所有 hunk 的增删行数，用于卡片头部的 `+N -M`。 */
export function diffStats(hunks: EditPreviewHunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const hunk of hunks) {
    for (const line of diffLines(hunk.before, hunk.after)) {
      if (line.type === 'add') added++
      else if (line.type === 'remove') removed++
    }
  }
  return { added, removed }
}

/** 提取文件卡片所需路径与差异；缺少路径时返回 `null` 以便回退到通用正文。 */
export function fileViewModel(tool: ToolCallData): FileViewModel | null {
  const input = tool.rawInput ?? {}
  const path = firstString(input.notebook_path, input.file_path, input.path)
  if (!path) return null
  return {
    path,
    hunks: toolEditPreview(input),
    output: formatOutput(tool),
    errored: tool.status === 'error',
  }
}
