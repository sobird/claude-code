import type { ToolCallData, ToolResultImage } from '@/lib/session-reducer'
import { diffLines, toolEditPreview, type EditPreviewHunk } from '@/lib/text-diff'

import { firstString, formatOutput } from './format'

export interface FileViewModel {
  path: string
  /** 编辑类工具的旧/新片段；`null` 表示展示原始文件内容或输出。 */
  hunks: EditPreviewHunk[] | null
  /** 读取类工具返回的图片预览（Read 图片文件时由 reducer 存入 `rawOutput.images`）。 */
  images: ToolResultImage[]
  output: string
  errored: boolean
  /** 写入体积（UTF-8 字节），仅在 ≥1KB 时给出，用于卡片头部后缀。 */
  inputSize: number | null
  /** 读取输出带行号时解析出的行；否则 `null`，退回普通文本输出。 */
  lines: ReadLine[] | null
}

export interface ReadLine {
  number: number
  text: string
}

const RASTER_IMAGE = /^image\/(png|jpeg|gif|webp)$/
const INPUT_SIZE_MIN = 1024
const encoder = new TextEncoder()
/** CLI 的两种行号前缀：默认 `     12→content`，紧凑模式 `12\tcontent`。 */
const NUMBERED_LINE = /^\s*(\d+)[\u2192\t](.*)$/
/** 至少六成行带行号才按行号视图渲染，避免误伤普通输出。 */
const NUMBERED_RATIO = 0.6

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** 读取预览图并过滤历史数据中的非法项（类型白名单、非空 data）。 */
function imagesFromTool(tool: ToolCallData): ToolResultImage[] {
  const raw = tool.rawOutput?.images
  if (!Array.isArray(raw)) return []
  const images: ToolResultImage[] = []
  for (const item of raw) {
    const record = asRecord(item)
    if (!record) continue
    const { mediaType, data } = record
    if (typeof mediaType !== 'string' || !RASTER_IMAGE.test(mediaType)) continue
    if (typeof data !== 'string' || !data) continue
    images.push({ mediaType, data })
  }
  return images
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

/**
 * 写入体积：Write 取 `content`，Edit 取 `new_string`，MultiEdit 累加各条
 * `new_string`；其余或不足 1KB 时返回 `null`。
 */
function inputSizeOf(input: Record<string, unknown>): number | null {
  let bytes = 0
  const content = input.content
  if (typeof content === 'string') bytes += encoder.encode(content).length
  const newString = input.new_string
  if (typeof newString === 'string') bytes += encoder.encode(newString).length
  if (Array.isArray(input.edits)) {
    for (const edit of input.edits) {
      const record = asRecord(edit)
      if (record && typeof record.new_string === 'string') bytes += encoder.encode(record.new_string).length
    }
  }
  return bytes >= INPUT_SIZE_MIN ? bytes : null
}

/** 将字节数格式化为卡片头部的 `1.5 KB` 形式。 */
export function formatInputSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`
}

/**
 * 解析 Read 输出里的行号前缀。要求行号连续且带行号的行占比足够高；
 * 否则返回 `null`，让调用方继续按普通文本渲染。
 */
export function readLinesFromOutput(output: string): ReadLine[] | null {
  if (!output) return null
  const rows = output.split('\n')
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop()
  if (rows.length === 0) return null
  const lines: ReadLine[] = []
  let earlierNumber: number | null = null
  for (const row of rows) {
    const match = NUMBERED_LINE.exec(row)
    if (!match) continue
    const number = Number(match[1])
    if (earlierNumber !== null && number !== earlierNumber + 1) return null
    earlierNumber = number
    lines.push({ number, text: match[2] ?? '' })
  }
  if (lines.length < 2 || lines.length / rows.length < NUMBERED_RATIO) return null
  return lines
}

/** 提取文件卡片所需路径与差异；缺少路径时返回 `null` 以便回退到通用正文。 */
export function fileViewModel(tool: ToolCallData): FileViewModel | null {
  const input = tool.rawInput ?? {}
  const path = firstString(input.notebook_path, input.file_path, input.path)
  if (!path) return null
  const hunks = toolEditPreview(input)
  const output = formatOutput(tool)
  return {
    path,
    hunks,
    images: imagesFromTool(tool),
    output,
    errored: tool.status === 'error',
    inputSize: inputSizeOf(input),
    lines: hunks ? null : readLinesFromOutput(output),
  }
}
