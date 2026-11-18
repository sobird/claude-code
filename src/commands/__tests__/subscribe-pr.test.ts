import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type { LocalJSXCommandContext } from '../../types/command.js'
import subscribePr from '../subscribe-pr.js'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'subscribe-pr-test-'))
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

async function run(args: string): Promise<string> {
  const { call } = await subscribePr.load()
  const result = await call(args, {} as LocalJSXCommandContext)
  if (result.type !== 'text') throw new Error(`unexpected result type: ${result.type}`)
  return result.value
}

describe('/subscribe-pr', () => {
  test('reports no subscriptions when empty', async () => {
    expect(await run('')).toContain('No active PR subscriptions')
  })

  test('subscribes to a PR reference', async () => {
    expect(await run('owner/repo#7')).toContain('Subscribed to owner/repo#7')
    expect(await run('list')).toContain('owner/repo#7')
  })

  test('reports an existing subscription instead of duplicating it', async () => {
    await run('owner/repo#7')

    expect(await run('owner/repo#7')).toContain('Already subscribed to owner/repo#7')
  })

  test('removes a subscription', async () => {
    await run('owner/repo#7')

    expect(await run('--remove owner/repo#7')).toContain('Unsubscribed from owner/repo#7')
    expect(await run('list')).toContain('No active PR subscriptions')
  })

  test('surfaces invalid references', async () => {
    expect(await run('not a pr')).toContain('Unrecognised PR reference')
  })
})
