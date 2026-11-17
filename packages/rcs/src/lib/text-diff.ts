/**
 * Minimal line diff for permission-card previews. Tools hand us whole old/new
 * strings (Edit's `old_string`/`new_string`, Write's `content`), so an LCS over
 * lines is enough; no character-level highlighting.
 */

export type DiffLineType = 'add' | 'remove' | 'context'

export interface DiffLine {
  type: DiffLineType
  text: string
}

export interface EditPreviewHunk {
  before: string
  after: string
  isNewFile?: boolean
}

/** Beyond this many lines per side, skip the quadratic LCS. */
const LCS_LINE_LIMIT = 500

function splitLines(text: string): string[] {
  return text === '' ? [] : text.split('\n')
}

function lcsDiff(before: string[], after: string[]): DiffLine[] {
  const rows = before.length
  const cols = after.length
  // lengths[i][j] = LCS length of before[i:] and after[j:]
  const lengths: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0))
  for (let i = rows - 1; i >= 0; i--) {
    const row = lengths[i]
    const next = lengths[i + 1]
    for (let j = cols - 1; j >= 0; j--) {
      row[j] = before[i] === after[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1])
    }
  }

  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < rows && j < cols) {
    if (before[i] === after[j]) {
      lines.push({ type: 'context', text: before[i] })
      i++
      j++
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      lines.push({ type: 'remove', text: before[i] })
      i++
    } else {
      lines.push({ type: 'add', text: after[j] })
      j++
    }
  }
  for (; i < rows; i++) lines.push({ type: 'remove', text: before[i] })
  for (; j < cols; j++) lines.push({ type: 'add', text: after[j] })
  return lines
}

function truncate(lines: DiffLine[], maxLines: number): DiffLine[] {
  if (lines.length <= maxLines) return lines
  // Keep the head of the diff so the first change stays visible.
  return lines.slice(0, maxLines)
}

/** Line-level diff, degrading to remove-all/add-all for very large inputs. */
export function diffLines(before: string, after: string, maxLines = 400): DiffLine[] {
  const beforeLines = splitLines(before)
  const afterLines = splitLines(after)

  if (beforeLines.length > LCS_LINE_LIMIT || afterLines.length > LCS_LINE_LIMIT) {
    const removed: DiffLine[] = beforeLines.map((text) => ({ type: 'remove', text }))
    const added: DiffLine[] = afterLines.map((text) => ({ type: 'add', text }))
    const lines = [...removed, ...added]
    if (lines.length <= maxLines) return lines
    // Show the start of the removals and the end of the additions.
    const head = Math.ceil(maxLines / 2)
    const tail = maxLines - head
    return [...removed.slice(0, head), ...added.slice(added.length - tail)]
  }

  return truncate(lcsDiff(beforeLines, afterLines), maxLines)
}

/**
 * Old/new pairs for file-editing tools, or null for anything else.
 * Edit → one hunk; MultiEdit → one per edit; Write → one whole-file addition.
 */
export function toolEditPreview(input: Record<string, unknown>): EditPreviewHunk[] | null {
  if (Array.isArray(input.edits)) {
    const hunks: EditPreviewHunk[] = []
    for (const edit of input.edits) {
      if (!edit || typeof edit !== 'object') continue
      const { old_string: oldString, new_string: newString } = edit as Record<string, unknown>
      if (typeof oldString !== 'string' || typeof newString !== 'string') continue
      hunks.push({ before: oldString, after: newString })
    }
    return hunks.length > 0 ? hunks : null
  }

  if (typeof input.old_string === 'string' && typeof input.new_string === 'string') {
    return [{ before: input.old_string, after: input.new_string }]
  }

  if (typeof input.content === 'string') {
    return [{ before: '', after: input.content, isNewFile: true }]
  }

  return null
}
