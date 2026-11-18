/**
 * SendUserFile — deliver one or more files to the user without a message body.
 *
 * Sibling of Brief (SendUserMessage): same attachment validation/upload path,
 * but a file-only turn. The REPL renderer (components/Messages.tsx) treats a
 * file-only delivery as an explicit presentation, so the assistant's text is
 * not dropped — this tool is for "here is the artifact", not "replace my
 * prose".
 *
 * Uploads (BRIDGE_MODE) are the same as Brief's: resolveAttachments stats the
 * files and, when the REPL bridge is enabled, uploads them for the mobile
 * client. Without the bridge the files remain local and render from disk.
 */

import { z } from 'zod/v4'

import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { plural } from '../../utils/stringUtils.js'
import { resolveAttachments, validateAttachmentPaths } from '../BriefTool/attachments.js'
import { isBriefEnabled } from '../BriefTool/BriefTool.js'
import { SEND_USER_FILE_TOOL_NAME } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    files: z
      .array(z.string())
      .min(1)
      .describe('File paths (absolute or relative to cwd) to deliver: images, diffs, logs, reports, or any artifact.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    files: z.array(
      z.object({
        path: z.string(),
        size: z.number(),
        isImage: z.boolean(),
        file_uuid: z.string().optional(),
      }),
    ),
    sentAt: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const SendUserFileTool = buildTool({
  name: SEND_USER_FILE_TOOL_NAME,
  searchHint: 'send files or artifacts to the user',
  maxResultSizeChars: 10_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    // Only meaningful when the assistant-facing channel (Brief) is active;
    // tools.ts already gates the import on KAIROS.
    return isBriefEnabled()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `SendUserFile ${input.files.join(', ')}`
  },
  renderToolUseMessage(input) {
    return `Send ${input.files?.join(', ') ?? 'files'}`
  },
  async validateInput({ files }, _context): Promise<ValidationResult> {
    return validateAttachmentPaths(files)
  },
  async description() {
    return 'Deliver files to the user.'
  },
  async prompt() {
    return 'Send one or more files to the user. Use this to present artifacts — screenshots, diffs, reports, logs — without a covering message. Paths may be absolute or relative to the working directory. If you also need to explain something, include the explanation in your normal reply text; do not repeat it in a separate message.'
  },
  async call({ files }, context) {
    const appState = context.getAppState()
    const resolved = await resolveAttachments(files, {
      replBridgeEnabled: appState.replBridgeEnabled,
      signal: context.abortController.signal,
    })
    return { data: { files: resolved, sentAt: new Date().toISOString() } }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const n = output.files.length
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: `Delivered ${n} ${plural(n, 'file')} to the user.`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
