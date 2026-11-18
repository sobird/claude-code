import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import * as React from 'react'

import { Ansi, Box, Text } from '../../ink.js'
import { parseGitHubWebhookActivities } from './parseGitHubWebhookActivity.js'

type Props = {
  addMargin: boolean
  param: TextBlockParam
}

/**
 * Render inbound GitHub webhook activity. The server delivers webhook events
 * wrapped in `<github-webhook-activity>`; the client sanitizer (see
 * bridge/webhookSanitizer.ts) only redacts secrets and preserves the tag.
 * UserTextMessage routes any message starting with that tag here.
 */
export function UserGitHubWebhookMessage({ addMargin, param }: Props): React.ReactNode {
  const activities = parseGitHubWebhookActivities(param.text)
  if (activities.length === 0) {
    return null
  }

  return (
    <Box flexDirection="column" marginTop={addMargin ? 1 : 0}>
      {activities.map((activity, index) => (
        // Render order is fixed for a finished message and activities carry no
        // stable id, so the index is a safe key here.
        // eslint-disable-next-line no-array-index-key
        <Box key={index} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
          <Text>
            <Text color="suggestion">GitHub</Text>
            <Text dimColor>
              {' '}
              {activity.event}
              {activity.repo ? ` · ${activity.repo}` : ''}
            </Text>
          </Text>
          <Box paddingLeft={2}>
            <Text>
              <Ansi>{activity.body}</Ansi>
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}
