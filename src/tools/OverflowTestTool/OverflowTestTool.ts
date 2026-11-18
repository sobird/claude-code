/**
 * OverflowTest — deliberately large tool result for exercising the
 * prompt-too-long / reactive-compaction paths.
 *
 * Test-only (feature('OVERFLOW_TEST_TOOL')). It allocates a filler string of
 * roughly the requested token count. Kept purely local: no network, no disk.
 */

import { z } from 'zod/v4'

import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

export const OVERFLOW_TEST_TOOL_NAME = 'OverflowTestTool'

/** Rough characters-per-token used to size the filler. */
const CHARS_PER_TOKEN = 4
/** Guard rail so a typo cannot allocate gigabytes. */
const MAX_TOKENS = 1_500_000

const inputSchema = lazySchema(() =>
  z.strictObject({
    tokens: z
      .number()
      .int()
      .min(1)
      .max(MAX_TOKENS)
      .default(100_000)
      .describe('Approximate number of tokens of filler to produce.'),
    label: z.string().optional().describe('Optional marker embedded every line so the result is identifiable.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    text: z.string(),
    approximateTokens: z.number(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const OverflowTestTool = buildTool({
  name: OVERFLOW_TEST_TOOL_NAME,
  searchHint: 'generate a large tool result for overflow testing',
  // The whole point is a large result: never persist it to disk.
  maxResultSizeChars: Infinity,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `OverflowTest ${input.tokens} tokens`
  },
  renderToolUseMessage(input) {
    return `OverflowTest ~${input.tokens} tokens`
  },
  async description() {
    return 'Emit a large filler tool result to test context-overflow handling.'
  },
  async prompt() {
    return 'Test-only tool. Emits roughly the requested number of tokens of filler text so the caller can exercise prompt-too-long handling and reactive compaction. Do not use it for real work.'
  },
  async call(input: z.infer<InputSchema>) {
    const targetChars = input.tokens * CHARS_PER_TOKEN
    const prefix = input.label ? `[${input.label}] ` : ''
    // Fixed-width lines keep the string build linear and memory predictable.
    const line = `${prefix}${'overflow-test '.repeat(6)}\n`
    const count = Math.max(1, Math.ceil(targetChars / line.length))
    const text = line.repeat(count)
    return { data: { text, approximateTokens: Math.round(text.length / CHARS_PER_TOKEN) } }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { type: 'tool_result', tool_use_id: toolUseID, content: output.text }
  },
} satisfies ToolDef<InputSchema, Output>)
