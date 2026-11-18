import { describe, expect, it } from 'bun:test'

import { isBtwCommand, parseBtwCommand } from '../side-question.js'

describe('parseBtwCommand', () => {
  it('returns the question after /btw', () => {
    expect(parseBtwCommand('/btw what changed?')).toBe('what changed?')
    expect(parseBtwCommand('/btw    spaced   ')).toBe('spaced')
  })

  it('is case-insensitive like the CLI trigger', () => {
    expect(parseBtwCommand('/BTW Are we done')).toBe('Are we done')
  })

  it('keeps multi-line questions intact', () => {
    expect(parseBtwCommand('/btw first line\nsecond line')).toBe('first line\nsecond line')
  })

  it('requires a word boundary after btw', () => {
    expect(parseBtwCommand('/btwx nope')).toBeNull()
    expect(parseBtwCommand('/btw2 nope')).toBeNull()
    expect(parseBtwCommand('/btw_more')).toBeNull()
  })

  it('returns null without a question', () => {
    expect(parseBtwCommand('/btw')).toBeNull()
    expect(parseBtwCommand('/btw   ')).toBeNull()
    expect(parseBtwCommand('/btw\n\n')).toBeNull()
  })

  it('returns null when /btw is not at the start', () => {
    expect(parseBtwCommand('hello /btw question')).toBeNull()
    expect(parseBtwCommand(' /btw question')).toBeNull()
    expect(parseBtwCommand('ordinary message')).toBeNull()
    expect(parseBtwCommand('')).toBeNull()
  })
})

describe('isBtwCommand', () => {
  it('detects the trigger even when the question is empty', () => {
    expect(isBtwCommand('/btw')).toBe(true)
    expect(isBtwCommand('/btw ')).toBe(true)
    expect(isBtwCommand('/BTW question')).toBe(true)
  })

  it('rejects lookalikes and ordinary text', () => {
    expect(isBtwCommand('/btwx')).toBe(false)
    expect(isBtwCommand('hello /btw')).toBe(false)
    expect(isBtwCommand('')).toBe(false)
  })
})
