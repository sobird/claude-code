import type { Command, LocalCommandCall } from '../types/command.js'
import { addPRSubscription, listPRSubscriptions, parsePRArg, removePRSubscription } from '../utils/prSubscriptions.js'

function formatSubscriptions(): string {
  const subscriptions = listPRSubscriptions()
  if (subscriptions.length === 0) {
    return 'No active PR subscriptions. Usage: /subscribe-pr <pr-url-or-number>'
  }
  const lines = subscriptions.map((s) => `  ${s.repo}#${s.prNumber}  (since ${s.subscribedAt})`)
  return `Active PR subscriptions:\n${lines.join('\n')}`
}

const call: LocalCommandCall = async (args) => {
  const trimmed = args.trim()

  if (!trimmed || trimmed === '--list' || trimmed === 'list') {
    return { type: 'text', value: formatSubscriptions() }
  }

  if (trimmed.startsWith('--remove ') || trimmed.startsWith('remove ')) {
    const reference = trimmed.replace(/^(--remove|remove)\s+/, '')
    const parsed = await parsePRArg(reference)
    if ('error' in parsed) {
      return { type: 'text', value: parsed.error }
    }
    const removed = removePRSubscription(parsed.repo, parsed.prNumber)
    return {
      type: 'text',
      value: removed
        ? `Unsubscribed from ${parsed.repo}#${parsed.prNumber}.`
        : `No subscription found for ${parsed.repo}#${parsed.prNumber}.`,
    }
  }

  const parsed = await parsePRArg(trimmed)
  if ('error' in parsed) {
    return { type: 'text', value: parsed.error }
  }

  const { added, subscription } = addPRSubscription(parsed.repo, parsed.prNumber)
  return {
    type: 'text',
    value: added
      ? `Subscribed to ${subscription.repo}#${subscription.prNumber}. You will receive notifications for comments, CI status, and reviews.`
      : `Already subscribed to ${subscription.repo}#${subscription.prNumber} (since ${subscription.subscribedAt}).`,
  }
}

const subscribePr = {
  type: 'local',
  name: 'subscribe-pr',
  aliases: ['watch-pr'],
  description: 'Subscribe to GitHub PR activity (comments, CI, reviews)',
  argumentHint: '<pr-url | owner/repo#123 | pr-number> [--list | --remove <ref>]',
  supportsNonInteractive: false,
  isHidden: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default subscribePr
