export const GITHUB_WEBHOOK_ACTIVITY_TAG = 'github-webhook-activity'

export type GitHubWebhookActivity = {
  event: string
  repo: string | undefined
  body: string
}

const BLOCK_PATTERN = new RegExp(
  `<${GITHUB_WEBHOOK_ACTIVITY_TAG}>\\n?([\\s\\S]*?)\\n?</${GITHUB_WEBHOOK_ACTIVITY_TAG}>`,
  'g',
)
const EVENT_PATTERN = /(?:^|\n)\s*event(?:[_-]?type)?\s*[:=]\s*["']?([^\s"',}]+)/i
const REPO_PATTERN = /(?:^|\n)\s*repo(?:sitory)?\s*[:=]\s*["']?([^"'\s,}]+)/i
const PR_URL_PATTERN = /https?:\/\/[^/\s]+\/([^/\s]+\/[^/\s]+)\/pull\/\d+/

function parseBody(body: string): GitHubWebhookActivity {
  return {
    event: body.match(EVENT_PATTERN)?.[1] ?? 'activity',
    repo: body.match(REPO_PATTERN)?.[1] ?? body.match(PR_URL_PATTERN)?.[1],
    body,
  }
}

/**
 * Parse every `<github-webhook-activity>` block in a message. The server
 * delivers webhook events wrapped in this tag; the renderer uses this to show
 * event metadata without executing raw text.
 */
export function parseGitHubWebhookActivities(text: string): GitHubWebhookActivity[] {
  const activities: GitHubWebhookActivity[] = []
  for (const match of text.matchAll(BLOCK_PATTERN)) {
    const body = match[1]?.trim()
    if (body) {
      activities.push(parseBody(body))
    }
  }
  return activities
}
