/**
 * ReviewArtifact — put an artifact in front of the user for explicit review.
 *
 * Upstream pairs this with a dedicated permission UI that renders the artifact
 * (plan, diff, document) before the model continues. The generic permission
 * system already gates the call; this implementation carries the artifact in
 * the tool result so both the transcript and SDK consumers receive the exact
 * text that was reviewed, and marks the operation destructive so a rejection
 * is meaningful.
 */

import { z } from 'zod/v4'

import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    title: z.string().min(1).describe('Short title for the artifact.'),
    content: z.string().min(1).describe('The artifact body to review (markdown, diff, or plain text).'),
    kind: z.enum(['plan', 'code', 'diff', 'document']).default('document').describe('Artifact kind.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    title: z.string(),
    kind: z.string(),
    content: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const ReviewArtifactTool = buildTool({
  name: 'ReviewArtifact',
  searchHint: 'present an artifact for user review',
  maxResultSizeChars: 200_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    // Loaded only under feature('REVIEW_ARTIFACT').
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `${input.kind}: ${input.title}`
  },
  renderToolUseMessage(input) {
    return `Review ${input.kind}: ${input.title}`
  },
  async description() {
    return 'Present an artifact to the user for explicit review.'
  },
  async prompt() {
    return 'Present an artifact — a plan, a code change, a diff, or a document — for the user to review before you proceed. The call is permission-gated, so the user sees and approves what you are about to act on. Keep the content self-contained: the reviewer should not need other context to judge it.'
  },
  async call(input: z.infer<InputSchema>) {
    return { data: { title: input.title, kind: input.kind, content: input.content } }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: `Reviewed ${output.kind}: ${output.title}\n\n${output.content}`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
