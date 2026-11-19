import axios from 'axios'

import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { validateBridgeId } from './bridgeApi.js'
import { getBridgeAccessToken } from './bridgeConfig.js'
import { extractErrorDetail } from './debugUtils.js'
import { getReplBridgeHandle } from './replBridgeHandle.js'
import { toCompatSessionId } from './sessionIdCompat.js'

/**
 * Send a plain-text message to another Claude session over Remote Control.
 *
 * Called by SendMessageTool for `bridge:<sessionId>` targets. The message is
 * POSTed to the target session's ingress API, which delivers it to the
 * receiving Claude as a user prompt — possibly on another machine. The sender
 * identity (`from`) is derived from the active REPL bridge handle.
 *
 * Never throws: callers surface `error` to the model as a failed tool result.
 */
export async function postInterClaudeMessage(
  target: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const handle = getReplBridgeHandle()
    if (!handle) {
      return { ok: false, error: 'Bridge not connected' }
    }

    const normalizedTarget = target.trim()
    if (!normalizedTarget) {
      return { ok: false, error: 'No target session specified' }
    }

    const accessToken = getBridgeAccessToken()
    if (!accessToken) {
      return { ok: false, error: 'No access token available' }
    }

    // Validate before interpolation — the target is model-supplied and goes
    // into a URL path (same allowlist as bridgeApi.ts).
    const compatTarget = validateBridgeId(toCompatSessionId(normalizedTarget), 'target sessionId')
    const from = toCompatSessionId(handle.bridgeSessionId)
    const url = `${handle.sessionIngressUrl}/v1/sessions/${encodeURIComponent(compatTarget)}/messages`

    const response = await axios.post(
      url,
      {
        type: 'peer_message',
        from,
        content: message,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        timeout: 10_000,
        // 4xx resolves so we can surface the server's error detail; 5xx throws.
        validateStatus: (status: number) => status < 500,
      },
    )

    if (response.status === 200 || response.status === 204) {
      logForDebugging(`[bridge:peer] Message sent to ${compatTarget} (${response.status})`)
      return { ok: true }
    }

    const detail = extractErrorDetail(response.data) ?? `HTTP ${response.status}`
    logForDebugging(`[bridge:peer] Send to ${compatTarget} failed: ${detail}`)
    return { ok: false, error: detail }
  } catch (error) {
    const detail = errorMessage(error)
    logForDebugging(`[bridge:peer] postInterClaudeMessage error: ${detail}`)
    return { ok: false, error: detail }
  }
}
