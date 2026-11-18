import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import React from 'react'
import stripAnsi from 'strip-ansi'

import { features } from '../scripts/config'
import { extractInboundMessageFields } from '../src/bridge/inboundMessages.js'
import { sanitizeInboundWebhookContent } from '../src/bridge/webhookSanitizer.js'
import subscribePr from '../src/commands/subscribe-pr.js'
import { GITHUB_WEBHOOK_ACTIVITY_TAG } from '../src/components/messages/parseGitHubWebhookActivity.js'
import { UserGitHubWebhookMessage } from '../src/components/messages/UserGitHubWebhookMessage.js'
import { SubscribePRTool } from '../src/tools/SubscribePRTool/SubscribePRTool.js'
import type { LocalJSXCommandContext } from '../src/types/command.js'
import { getPRSubscriptionsFilePath, listPRSubscriptions } from '../src/utils/prSubscriptions.js'
import { cleanup, renderForTest } from './ink-harness.js'

const WEBHOOK_TAG = `<${GITHUB_WEBHOOK_ACTIVITY_TAG}>`
const GITHUB_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'github-webhooks-e2e-'))
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

beforeEach(() => {
  process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(tmpRoot, 'cfg-'))
})

// Tear down any Ink instance a case did not unmount.
afterEach(cleanup)

afterAll(() => {
  if (originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

/** Shape mirrors an inbound CCR bridge message (see useReplBridge). */
function inboundUserMessage(content: string) {
  return {
    type: 'user' as const,
    uuid: '00000000-0000-4000-8000-000000000001',
    message: { role: 'user' as const, content },
  }
}

/**
 * Run the same three steps as useReplBridge.handleInboundMessage: extract
 * fields, sanitize, then decide routing. Returns both the sanitized content
 * and whether UserTextMessage would route it to the webhook renderer.
 */
function ingest(content: string): { sanitized: string; routedToWebhook: boolean } {
  const fields = extractInboundMessageFields(inboundUserMessage(content) as never)
  if (!fields) {
    throw new Error('inbound message produced no fields')
  }
  if (typeof fields.content !== 'string') {
    throw new Error('expected string content in this test')
  }
  const sanitized = sanitizeInboundWebhookContent(fields.content)
  return { sanitized, routedToWebhook: sanitized.startsWith(WEBHOOK_TAG) }
}

async function runCommand(args: string): Promise<string> {
  const { call } = await subscribePr.load()
  const result = await call(args, {} as LocalJSXCommandContext)
  if (result.type !== 'text') throw new Error(`unexpected result type: ${result.type}`)
  return result.value
}

async function callTool(input: Record<string, unknown>) {
  const result = await SubscribePRTool.call(input as never)
  return result.data
}

describe('KAIROS_GITHUB_WEBHOOKS end to end', () => {
  test('the feature flag ships enabled in scripts/config.ts', () => {
    expect(features).toContain('KAIROS_GITHUB_WEBHOOKS')
  })

  test('a server-tagged webhook event is redacted, routed, and rendered', async () => {
    const subscribed = await runCommand('owner/repo#42')
    expect(subscribed).toContain('Subscribed to owner/repo#42')

    const delivered = [
      WEBHOOK_TAG,
      'event_type: check_run',
      'repo: owner/repo',
      `token=${GITHUB_TOKEN}`,
      'Check run "ci" completed successfully for https://github.com/owner/repo/pull/42',
      '</github-webhook-activity>',
    ].join('\n')

    const { sanitized, routedToWebhook } = ingest(delivered)

    // The tag survives sanitization so routing still works; the credential does not.
    expect(routedToWebhook).toBe(true)
    expect(sanitized).toContain('event_type: check_run')
    expect(sanitized).toContain('[REDACTED_GITHUB_TOKEN]')
    expect(sanitized).not.toContain(GITHUB_TOKEN)

    const app = await renderForTest(
      <UserGitHubWebhookMessage addMargin={false} param={{ type: 'text', text: sanitized }} />,
    )
    const rendered = stripAnsi(app.lastFrame())

    expect(rendered).toContain('GitHub')
    expect(rendered).toContain('check_run')
    expect(rendered).toContain('owner/repo')
    expect(rendered).toContain('Check run "ci" completed successfully')
    expect(rendered).not.toContain(GITHUB_TOKEN)
  })

  test('an ordinary remote prompt is not misrouted as webhook activity', () => {
    const prompt = 'Please fix the failing test in src/foo.ts'

    const { sanitized, routedToWebhook } = ingest(prompt)

    expect(sanitized).toBe(prompt)
    expect(routedToWebhook).toBe(false)
  })

  test('subscriptions are shared between the slash command, the tool, and disk', async () => {
    await runCommand('owner/repo#42')

    const listed = await callTool({ action: 'list' })
    if (listed.action !== 'list') throw new Error('unexpected action')
    expect(listed.subscriptions).toHaveLength(1)
    expect(listed.subscriptions[0]).toMatchObject({ repo: 'owner/repo', prNumber: 42 })

    // Persisted on disk in the config dir the bridge and next session read.
    const onDisk = JSON.parse(fs.readFileSync(getPRSubscriptionsFilePath(), 'utf8'))
    expect(onDisk).toEqual([expect.objectContaining({ repo: 'owner/repo', prNumber: 42 })])

    const removed = await callTool({ action: 'unsubscribe', repo: 'owner/repo', pr_number: 42 })
    expect(removed).toMatchObject({ action: 'unsubscribe', unsubscribed: true })

    expect(await runCommand('list')).toContain('No active PR subscriptions')
    expect(listPRSubscriptions()).toHaveLength(0)
  })
})
