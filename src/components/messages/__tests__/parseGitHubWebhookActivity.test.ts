import { describe, expect, test } from 'bun:test'

import { parseGitHubWebhookActivities } from '../parseGitHubWebhookActivity.js'

const wrap = (body: string) => `<github-webhook-activity>\n${body}\n</github-webhook-activity>`

describe('parseGitHubWebhookActivities', () => {
  test('returns no activities when the wrapper tag is absent', () => {
    expect(parseGitHubWebhookActivities('plain user message')).toEqual([])
  })

  test('extracts event and repo from metadata lines', () => {
    const text = wrap('Event: pull_request_review_comment\nRepo: owner/repo\nBody: looks good')

    expect(parseGitHubWebhookActivities(text)).toEqual([
      {
        event: 'pull_request_review_comment',
        repo: 'owner/repo',
        body: 'Event: pull_request_review_comment\nRepo: owner/repo\nBody: looks good',
      },
    ])
  })

  test('falls back to generic activity when metadata is missing', () => {
    expect(parseGitHubWebhookActivities(wrap('CI run completed'))).toEqual([
      { event: 'activity', repo: undefined, body: 'CI run completed' },
    ])
  })

  test('infers the repo from a pull request URL in the body', () => {
    const text = wrap('See https://github.com/owner/repo/pull/12 for details')

    expect(parseGitHubWebhookActivities(text)[0]?.repo).toBe('owner/repo')
  })

  test('parses multiple wrapped activities', () => {
    const text = `${wrap('Event: push\nRepo: a/b')}\n${wrap('Event: check_run\nRepo: c/d')}`

    expect(parseGitHubWebhookActivities(text).map((a) => a.event)).toEqual(['push', 'check_run'])
  })
})
