/**
 * PushNotification — raise a notification the user sees away from the REPL.
 *
 * The upstream tool forwards to the mobile/RCS push transport when the
 * session is bridged. This tree has no push transport exposed to the CLI
 * (`src/bridge` only carries session messaging), so the implementation uses
 * the existing OS-notification channel wired into ToolUseContext
 * (`sendOSNotification`) — iTerm2/Kitty/Ghostty/bell — and reports whether a
 * channel accepted it. When the REPL bridge grows a push endpoint, this is
 * the single place to route through.
 */

import { z } from 'zod/v4'

import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    message: z.string().min(1).describe('Notification body shown to the user.'),
    title: z.string().optional().describe('Optional title.'),
    kind: z
      .enum(['info', 'permission', 'question', 'plan'])
      .default('info')
      .describe('Notification category; mirrors the RCS push payload kinds.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    delivered: z.boolean(),
    channel: z.enum(['os', 'none']),
    kind: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const PushNotificationTool = buildTool({
  name: 'PushNotification',
  searchHint: 'notify the user out of band',
  maxResultSizeChars: 2_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    // Loaded only under feature('KAIROS') / KAIROS_PUSH_NOTIFICATION.
    return true
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.message
  },
  renderToolUseMessage(input) {
    return input.message
  },
  async description() {
    return 'Send the user a notification outside the terminal transcript.'
  },
  async prompt() {
    return 'Notify the user about something they should see even if they are not watching the transcript — a long task finished, you are blocked and need input, or a background job needs attention. Keep the message short and concrete. Do not use this to ask questions you could ask in your normal reply, and do not use it to repeat what you just said.'
  },
  async call(input, context) {
    const text = input.title ? `${input.title}: ${input.message}` : input.message
    if (!context.sendOSNotification) {
      return { data: { delivered: false, channel: 'none', kind: input.kind } }
    }
    context.sendOSNotification({ message: text, notificationType: `push_${input.kind}` })
    return { data: { delivered: true, channel: 'os', kind: input.kind } }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: output.delivered
        ? 'Notification sent.'
        : 'No notification channel is available in this session; nothing was sent.',
    }
  },
} satisfies ToolDef<InputSchema, Output>)
