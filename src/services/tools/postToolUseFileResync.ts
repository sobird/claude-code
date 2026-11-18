import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '../../tools/FileWriteTool/prompt.js'
import type { AttachmentMessage } from '../../types/message.js'
import { createAttachmentMessage } from '../../utils/attachments.js'
import { logForDebugging } from '../../utils/debug.js'
import { getFileModificationTime } from '../../utils/file.js'
import { readFileSyncWithMetadata } from '../../utils/fileRead.js'
import type { FileStateCache } from '../../utils/fileStateCache.js'
import { expandPath } from '../../utils/path.js'

/**
 * PostToolUse hooks commonly run formatters that rewrite the file the model
 * just edited. Without re-reading, the next Edit fails with a stale-file
 * error and the model wastes a turn. If the hook changed the content, also
 * tell the model that its old_string may no longer match.
 */
export function resyncReadFileStateAfterPostToolUseHooks(
  toolName: string,
  toolUseID: string,
  toolInput: Record<string, unknown>,
  readFileState: FileStateCache,
): AttachmentMessage | null {
  if (toolName !== FILE_EDIT_TOOL_NAME && toolName !== FILE_WRITE_TOOL_NAME) {
    return null
  }
  const rawFilePath = toolInput.file_path
  if (typeof rawFilePath !== 'string') {
    return null
  }

  try {
    const filePath = expandPath(rawFilePath)
    const prior = readFileState.get(filePath)
    // Only full reads can back Edit/Write; a windowed read is not a valid
    // freshness baseline and is left alone.
    if (!prior || prior.offset !== undefined || prior.limit !== undefined) {
      return null
    }

    const timestamp = getFileModificationTime(filePath)
    if (timestamp <= prior.timestamp) {
      return null
    }

    const content = readFileSyncWithMetadata(filePath).content
    readFileState.set(filePath, { content, timestamp, offset: undefined, limit: undefined })
    if (content === prior.content) {
      return null
    }

    logForDebugging(`PostToolUse hook modified ${filePath} after ${toolName} — re-synced readFileState`, {
      level: 'info',
    })
    return createAttachmentMessage({
      type: 'hook_additional_context',
      content: [
        `PostToolUse hook modified ${filePath} after your edit (likely a formatter). Your next Edit will not fail with a stale-file error, but if its old_string targets a region the hook reformatted, Read the file first.`,
      ],
      hookName: `PostToolUse:${toolName}`,
      toolUseID,
      hookEvent: 'PostToolUse',
    })
  } catch {
    return null
  }
}
