import axios from 'axios'

import { getOauthConfig } from '../../constants/oauth.js'
import { getOrganizationUUID } from '../../services/oauth/client.js'
import type { Command, LocalCommandCall } from '../../types/command.js'
import { checkAndRefreshOAuthTokenIfNeeded, getClaudeAIOAuthTokens } from '../../utils/auth.js'
import { cronToHuman } from '../../utils/cron.js'
import { errorMessage } from '../../utils/errors.js'

const TRIGGERS_BETA = 'ccr-triggers-2026-01-30'

type RemoteTrigger = {
  id?: string
  name?: string
  description?: string
  cron?: string
  enabled?: boolean
}

function formatTrigger(trigger: RemoteTrigger): string {
  const label = trigger.name || trigger.description || trigger.id || 'untitled trigger'
  const schedule = trigger.cron ? cronToHuman(trigger.cron, { utc: true }) : 'no schedule'
  const state = trigger.enabled === false ? 'paused' : 'active'
  return `- ${label} (${schedule}, ${state})`
}

function extractTriggers(data: unknown): RemoteTrigger[] {
  if (Array.isArray(data)) return data as RemoteTrigger[]
  if (typeof data === 'object' && data !== null) {
    const record = data as Record<string, unknown>
    for (const key of ['triggers', 'data']) {
      const value = record[key]
      if (Array.isArray(value)) return value as RemoteTrigger[]
    }
  }
  return []
}

/**
 * `/agents-platform` (ant-only) — read-only view of the scheduled remote
 * agents (CCR triggers) owned by the signed-in claude.ai account. Trigger cron
 * strings are UTC on the server, so they're rendered in local time via
 * `cronToHuman(..., { utc: true })`.
 */
const call: LocalCommandCall = async () => {
  await checkAndRefreshOAuthTokenIfNeeded()
  const accessToken = getClaudeAIOAuthTokens()?.accessToken
  if (!accessToken) {
    return { type: 'text', value: 'Not authenticated with a claude.ai account. Run /login and try again.' }
  }

  const orgUUID = await getOrganizationUUID()
  if (!orgUUID) {
    return { type: 'text', value: 'Unable to resolve organization UUID.' }
  }

  try {
    const res = await axios.get(`${getOauthConfig().BASE_API_URL}/v1/code/triggers`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': TRIGGERS_BETA,
        'x-organization-uuid': orgUUID,
      },
      timeout: 20_000,
      validateStatus: () => true,
    })

    if (res.status !== 200) {
      return { type: 'text', value: `Failed to list remote agents (HTTP ${res.status}).` }
    }

    const triggers = extractTriggers(res.data)
    if (triggers.length === 0) {
      return {
        type: 'text',
        value: 'No scheduled remote agents found. Create one with the RemoteTrigger tool.',
      }
    }

    return {
      type: 'text',
      value: [`Scheduled remote agents (${triggers.length}):`, ...triggers.map(formatTrigger)].join('\n'),
    }
  } catch (error) {
    return { type: 'text', value: `Failed to list remote agents: ${errorMessage(error)}` }
  }
}

const agentsPlatform = {
  type: 'local',
  name: 'agents-platform',
  description: 'List scheduled remote agents on the Claude Code platform',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default agentsPlatform
