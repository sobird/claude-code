import type { LogOption, SerializedMessage } from 'src/types/logs.js'

import { logForDebugging } from './debug.js'

/** Base URL for ccshare links; `https://go/ccshare/<id>` is the internal form. */
const DEFAULT_CCSHARE_BASE_URL = 'https://go/ccshare'

/** `<owner>-YYYYMMDD-HHMMSS` — the shape shared links use as their path segment. */
const CCSHARE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*-\d{8}-\d{6}$/i

/**
 * Extract a ccshare id from a `--resume` argument. Only URL forms count — a
 * bare path or session id must fall through to the normal resume handling, so
 * anything without a `/ccshare/` segment returns null.
 */
export function parseCcshareId(resume: string): string | null {
  const match = /\/ccshare\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(resume)
  if (!match?.[1]) {
    return null
  }
  return CCSHARE_ID_PATTERN.test(match[1]) ? match[1] : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

/** First user prompt, truncated — shown as the resume entry's label. */
function firstPromptOf(messages: SerializedMessage[]): string {
  for (const message of messages) {
    if (message.type !== 'user') {
      continue
    }
    const content = message.message.content
    if (typeof content === 'string') {
      return content.slice(0, 200)
    }
    for (const block of content) {
      if (block.type === 'text') {
        return block.text.slice(0, 200)
      }
    }
  }
  return ''
}

/**
 * Fetch a shared session and normalize it into the `LogOption` shape the
 * resume path expects. The payload is remote and untrusted: a missing
 * `messages` array is a hard error, everything else is best-effort metadata.
 */
export async function loadCcshare(ccshareId: string): Promise<LogOption> {
  const baseUrl = (process.env.CLAUDE_CODE_CCSHARE_BASE_URL ?? DEFAULT_CCSHARE_BASE_URL).replace(/\/+$/, '')
  const url = `${baseUrl}/${encodeURIComponent(ccshareId)}`
  logForDebugging(`ccshare: fetching ${url}`)

  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`ccshare fetch failed (${response.status} ${response.statusText})`)
  }

  const payload: unknown = await response.json()
  if (!isRecord(payload) || !Array.isArray(payload.messages)) {
    throw new Error('ccshare payload is missing a messages array')
  }
  const messages = payload.messages as SerializedMessage[]
  if (messages.length === 0) {
    throw new Error('ccshare session has no messages')
  }

  const now = new Date()
  const date = optionalString(payload.date) ?? now.toISOString()

  return {
    date,
    messages,
    value: now.getTime(),
    created: new Date(date),
    modified: now,
    firstPrompt: optionalString(payload.firstPrompt) ?? firstPromptOf(messages),
    messageCount: messages.length,
    isSidechain: false,
    sessionId: optionalString(payload.sessionId) ?? ccshareId,
    summary: optionalString(payload.summary),
    customTitle: optionalString(payload.customTitle),
    tag: optionalString(payload.tag),
    gitBranch: optionalString(payload.gitBranch),
    entrypoint: optionalString(payload.entrypoint),
    projectPath: optionalString(payload.projectPath),
    agentName: optionalString(payload.agentName),
    agentColor: optionalString(payload.agentColor),
    agentSetting: optionalString(payload.agentSetting),
    prNumber: optionalNumber(payload.prNumber),
    prUrl: optionalString(payload.prUrl),
    prRepository: optionalString(payload.prRepository),
  }
}
