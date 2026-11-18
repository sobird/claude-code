import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { listPRSubscriptions } from '../../../utils/prSubscriptions.js'
import { SubscribePRTool } from '../SubscribePRTool.js'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'subscribe-tool-test-'))
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

beforeEach(() => {
  process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(tmpRoot, 'cfg-'))
})

afterAll(() => {
  if (originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

async function call(input: Record<string, unknown>) {
  const result = await SubscribePRTool.call(input as never)
  return result.data
}

describe('SubscribePRTool', () => {
  test('subscribes to a PR', async () => {
    const data = await call({ action: 'subscribe', repo: 'owner/repo', pr_number: 5 })

    expect(data).toMatchObject({ action: 'subscribe', subscribed: true, alreadySubscribed: false })
    expect(listPRSubscriptions()).toHaveLength(1)
  })

  test('reports an existing subscription without duplicating it', async () => {
    await call({ action: 'subscribe', repo: 'owner/repo', pr_number: 5 })
    const data = await call({ action: 'subscribe', repo: 'owner/repo', pr_number: 5 })

    expect(data).toMatchObject({ subscribed: true, alreadySubscribed: true })
    expect(listPRSubscriptions()).toHaveLength(1)
  })

  test('lists subscriptions', async () => {
    await call({ action: 'subscribe', repo: 'owner/repo', pr_number: 5 })
    const data = await call({ action: 'list' })

    expect(data).toMatchObject({ action: 'list' })
    if (data.action !== 'list') throw new Error('unexpected action')
    expect(data.subscriptions).toHaveLength(1)
  })

  test('unsubscribes from a PR', async () => {
    await call({ action: 'subscribe', repo: 'owner/repo', pr_number: 5 })
    const data = await call({ action: 'unsubscribe', repo: 'owner/repo', pr_number: 5 })

    expect(data).toMatchObject({ action: 'unsubscribe', unsubscribed: true })
    expect(listPRSubscriptions()).toHaveLength(0)
  })

  test('rejects a missing repo or PR number', async () => {
    expect(call({ action: 'subscribe', repo: 'owner/repo' })).rejects.toThrow()
    expect(call({ action: 'subscribe', pr_number: 5 })).rejects.toThrow()
  })
})
