import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { addPRSubscription, listPRSubscriptions, parsePRArg, removePRSubscription } from '../prSubscriptions.js'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-subs-test-'))
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

describe('PR subscription store', () => {
  test('adds and lists a subscription', () => {
    const result = addPRSubscription('owner/repo', 42)

    expect(result.added).toBe(true)
    expect(result.subscription).toMatchObject({ repo: 'owner/repo', prNumber: 42 })
    expect(listPRSubscriptions()).toHaveLength(1)
    expect(listPRSubscriptions()[0]).toMatchObject({ repo: 'owner/repo', prNumber: 42 })
  })

  test('does not duplicate an existing subscription', () => {
    addPRSubscription('owner/repo', 42)
    const second = addPRSubscription('owner/repo', 42)

    expect(second.added).toBe(false)
    expect(listPRSubscriptions()).toHaveLength(1)
  })

  test('removes a subscription', () => {
    addPRSubscription('owner/repo', 42)

    expect(removePRSubscription('owner/repo', 42)).toBe(true)
    expect(listPRSubscriptions()).toHaveLength(0)
    expect(removePRSubscription('owner/repo', 42)).toBe(false)
  })

  test('treats a corrupt subscriptions file as empty', () => {
    fs.writeFileSync(path.join(process.env.CLAUDE_CONFIG_DIR!, 'pr-subscriptions.json'), '{not json')

    expect(listPRSubscriptions()).toEqual([])
  })

  test('rejects invalid repo names', () => {
    expect(() => addPRSubscription('owner', 1)).toThrow()
    expect(() => addPRSubscription('owner/repo', 0)).toThrow()
  })
})

describe('parsePRArg', () => {
  test('parses a full GitHub pull request URL', async () => {
    expect(await parsePRArg('https://github.com/owner/repo/pull/123')).toEqual({
      repo: 'owner/repo',
      prNumber: 123,
    })
  })

  test('parses an owner/repo#number reference', async () => {
    expect(await parsePRArg('owner/repo#7')).toEqual({ repo: 'owner/repo', prNumber: 7 })
  })

  test('rejects unrecognised references', async () => {
    expect(await parsePRArg('not a pr')).toHaveProperty('error')
    expect(await parsePRArg('owner/repo#0')).toHaveProperty('error')
  })
})
