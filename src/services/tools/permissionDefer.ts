import { tailFile } from '../../utils/fsOperations.js'

/**
 * PreToolUse hook permission decisions can return `defer` to pause a headless
 * (`-p`/SDK) session instead of denying the tool. The tool is not executed and
 * a `hook_deferred_tool` attachment is written to the transcript; a later
 * `-p --resume` re-emits the same tool use through PreToolUse so the hook (or
 * permission flow) can approve it.
 *
 * Deferral is only meaningful for a solo tool call in a non-interactive
 * session:
 * - interactive sessions have a live permission dialog, so `defer` is ignored;
 * - a sibling tool_use in the same assistant message would be orphaned on
 *   resume (only the deferred call is re-emitted), so batches are ignored.
 */
export function shouldDeferPermission(opts: {
  isNonInteractive: boolean
  permissionBehavior: string | undefined
  toolUseCountInBatch: number
}): boolean {
  return opts.isNonInteractive && opts.permissionBehavior === 'defer' && opts.toolUseCountInBatch <= 1
}

export type DeferredToolUse = {
  id: string
  name: string
  input: unknown
  /** Permission mode recorded when the tool was deferred (for resume warnings). */
  permissionMode: string
}

/** Bytes of transcript tail scanned when looking for a deferred-tool marker. */
const TRANSCRIPT_TAIL_BYTES = 1024 * 1024
const DEFERRED_MARKER_SUBSTRING = '"hook_deferred_tool"'

type DeferredAttachmentLike = {
  type: 'hook_deferred_tool'
  toolUseID: string
  toolName: string
  toolInput: unknown
  permissionMode: string
}

/**
 * Scan the last 1 MB of a transcript for the most recent `hook_deferred_tool`
 * attachment that has not already been resolved.
 *
 * The marker is stale (returns undefined) when a later transcript line
 * references the same tool_use_id as a tool_result — the tool already ran, so
 * resuming must not re-emit it. Malformed lines are ignored. Any read/parse
 * failure is treated as "no marker".
 */
export async function readDeferredToolUse(transcriptPath: string): Promise<DeferredToolUse | undefined> {
  try {
    const { content, bytesRead, bytesTotal } = await tailFile(transcriptPath, TRANSCRIPT_TAIL_BYTES)
    const lines = content.split('\n')
    // If the file was larger than the window, the first line is a partial JSON
    // object left over from the middle of a record — drop it.
    if (bytesRead < bytesTotal) {
      lines.shift()
    }

    let attachment: DeferredAttachmentLike | undefined
    let markerIndex = -1
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (!line.includes(DEFERRED_MARKER_SUBSTRING)) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }
      const candidate = parsed as {
        type?: string
        attachment?: DeferredAttachmentLike
      }
      if (candidate.type === 'attachment' && candidate.attachment?.type === 'hook_deferred_tool') {
        attachment = candidate.attachment
        markerIndex = i
        break
      }
    }

    if (!attachment) {
      return undefined
    }

    const toolResultMarker = `"tool_use_id":"${attachment.toolUseID}"`
    for (let i = markerIndex + 1; i < lines.length; i++) {
      if (lines[i].includes(toolResultMarker)) {
        return undefined
      }
    }

    return {
      id: attachment.toolUseID,
      name: attachment.toolName,
      input: attachment.toolInput,
      permissionMode: attachment.permissionMode,
    }
  } catch {
    return undefined
  }
}
