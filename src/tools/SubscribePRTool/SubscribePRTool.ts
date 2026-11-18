import { z } from 'zod/v4'

import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  addPRSubscription,
  listPRSubscriptions,
  removePRSubscription,
  type PRSubscription,
} from '../../utils/prSubscriptions.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(['subscribe', 'unsubscribe', 'list'])
      .default('subscribe')
      .describe('Whether to subscribe, unsubscribe, or list current subscriptions.'),
    repo: z.string().optional().describe('Repository in owner/repo form. Required for subscribe and unsubscribe.'),
    pr_number: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Pull request number. Required for subscribe and unsubscribe.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

type Output =
  | { action: 'list'; subscriptions: PRSubscription[] }
  | { action: 'subscribe'; subscribed: boolean; alreadySubscribed: boolean; repo: string; prNumber: number }
  | { action: 'unsubscribe'; unsubscribed: boolean; repo: string; prNumber: number }

function requireTarget(input: z.infer<InputSchema>): { repo: string; prNumber: number } {
  if (!input.repo || input.pr_number === undefined) {
    throw new Error('repo and pr_number are required for subscribe and unsubscribe')
  }
  return { repo: input.repo, prNumber: input.pr_number }
}

const SubscribePRTool = buildTool({
  name: 'SubscribePR',
  searchHint: 'subscribe github pull request activity',
  maxResultSizeChars: 5_000,
  strict: true,
  async description() {
    return 'Subscribe to GitHub PR activity (comments, CI status, reviews) so updates reach this session.'
  },
  async prompt() {
    return 'Subscribe to a GitHub pull request to receive its activity (comments, CI status, reviews) in this session. Use action "subscribe" with a repo and pr_number, "unsubscribe" to stop, or "list" to inspect current subscriptions.'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  userFacingName() {
    return 'SubscribePR'
  },
  isReadOnly() {
    return false
  },
  async call(input) {
    if (input.action === 'list') {
      return { data: { action: 'list', subscriptions: listPRSubscriptions() } }
    }

    const { repo, prNumber } = requireTarget(input)

    if (input.action === 'unsubscribe') {
      return {
        data: { action: 'unsubscribe', unsubscribed: removePRSubscription(repo, prNumber), repo, prNumber },
      }
    }

    const { added } = addPRSubscription(repo, prNumber)
    return {
      data: { action: 'subscribe', subscribed: true, alreadySubscribed: !added, repo, prNumber },
    }
  },
  renderToolUseMessage(input) {
    if (input.action === 'list') {
      return 'Listing PR subscriptions'
    }
    const target = input.repo && input.pr_number !== undefined ? `${input.repo}#${input.pr_number}` : 'a PR'
    return input.action === 'unsubscribe' ? `Unsubscribing from ${target}` : `Subscribing to ${target}`
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    let text: string
    switch (content.action) {
      case 'list':
        text =
          content.subscriptions.length === 0
            ? 'No active PR subscriptions.'
            : content.subscriptions.map((s) => `${s.repo}#${s.prNumber} (since ${s.subscribedAt})`).join('\n')
        break
      case 'subscribe':
        text = content.alreadySubscribed
          ? `Already subscribed to ${content.repo}#${content.prNumber}.`
          : `Subscribed to ${content.repo}#${content.prNumber}.`
        break
      case 'unsubscribe':
        text = content.unsubscribed
          ? `Unsubscribed from ${content.repo}#${content.prNumber}.`
          : `No subscription found for ${content.repo}#${content.prNumber}.`
        break
    }
    return { type: 'tool_result', tool_use_id: toolUseID, content: text }
  },
} satisfies ToolDef<InputSchema, Output>)

export { SubscribePRTool }
