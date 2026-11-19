import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import type { MemoryScope } from '../utils/memoryFileDetection.js'
import type { MemoryHeader } from './memoryScan.js'

/**
 * Recall telemetry: how many memory candidates were offered vs. picked.
 *
 * Fires even on an empty selection (callers rely on the denominator to
 * compute selection rate), so `selected_count: 0` is a meaningful datapoint.
 */
export function logMemoryRecallShape(memories: MemoryHeader[], selected: MemoryHeader[]): void {
  logEvent('tengu_memory_shape_recall', {
    candidate_count: memories.length,
    selected_count: selected.length,
  })
}

/**
 * Write telemetry: which tool wrote a memory file, in which scope, and how
 * large the body was.
 *
 * The Write tool carries the full file body in `content`; Edit carries only
 * `old_string`/`new_string`, so `content_length` is omitted there.
 */
export function logMemoryWriteShape(toolName: string, toolInput: unknown, _filePath: string, scope: MemoryScope): void {
  const content =
    typeof toolInput === 'object' &&
    toolInput !== null &&
    'content' in toolInput &&
    typeof toolInput.content === 'string'
      ? toolInput.content
      : undefined
  logEvent('tengu_memory_shape_write', {
    tool: toolName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    content_length: content?.length,
  })
}
