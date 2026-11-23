import type { ToolCallData } from '@/lib/session-reducer'
import { canonicalToolName } from '@/lib/tool-summary'

import { firstString, formatOutput } from './format'

export interface SearchViewModel {
  pattern: string
  path: string
  glob: string
  output: string
  errored: boolean
  /** 命中文件数；无法从输出判断时 `null`。 */
  files: number | null
  /** 命中次数；仅 count 模式提供，其余为 `null`。 */
  matches: number | null
}

/** Grep files_with_matches 的首行摘要。 */
const FOUND_FILES = /^Found (\d+) files?$/m
/** Grep count 模式末尾的汇总行。 */
const FOUND_OCCURRENCES = /^Found (\d+) total occurrences? across (\d+) files?\.$/m
/** Glob 结果被截断时追加的提示行。 */
const TRUNCATED_NOTICE = /^\(Results are truncated\./

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 从搜索输出里解析文件数/匹配数；优先 stream-json 的结构化输出，其次文本摘要。 */
function parseSearchStats(tool: ToolCallData, output: string): Pick<SearchViewModel, 'files' | 'matches'> {
  const none = { files: null, matches: null }
  const meta = asRecord(tool.rawOutput?.toolUseResult)
  if (meta) {
    const files = numberOrNull(meta.numFiles)
    if (files !== null) return { files, matches: numberOrNull(meta.numMatches) }
  }
  if (!output) return none
  if (/^No files found$/m.test(output)) return { files: 0, matches: null }
  const occurrences = FOUND_OCCURRENCES.exec(output)
  if (occurrences) return { files: Number(occurrences[2]), matches: Number(occurrences[1]) }
  const files = FOUND_FILES.exec(output)
  if (files) return { files: Number(files[1]), matches: null }
  if (canonicalToolName(tool.title) === 'Glob') {
    const count = output.split('\n').filter((line) => line && !TRUNCATED_NOTICE.test(line)).length
    return count > 0 ? { files: count, matches: null } : none
  }
  return none
}

/** 提取搜索卡片所需的模式与范围；缺少模式时返回 `null` 以便回退到通用正文。 */
export function searchViewModel(tool: ToolCallData): SearchViewModel | null {
  const input = tool.rawInput ?? {}
  const pattern = firstString(input.pattern)
  if (!pattern) return null
  const output = formatOutput(tool)
  return {
    pattern,
    path: firstString(input.path),
    glob: firstString(input.glob),
    output,
    errored: tool.status === 'error',
    ...parseSearchStats(tool, output),
  }
}
