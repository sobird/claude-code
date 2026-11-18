import { describe, expect, test } from 'bun:test'

import { POWERUP_LESSONS, getUnlockedPowerupIds, parseDemoText } from '../powerup.js'

describe('powerup lessons', () => {
  test('exposes the 2.1.90 lesson ids in order', () => {
    expect(POWERUP_LESSONS.map((lesson) => lesson.id)).toEqual([
      'at-mentions',
      'modes',
      'undo',
      'background',
      'memory',
      'mcp',
      'automate',
      'subagents',
      'cross-device',
      'model-dial',
    ])
  })

  test('filters unknown ids out of the persisted config', () => {
    expect(getUnlockedPowerupIds(['undo', 'not-a-lesson'])).toEqual(['undo'])
  })

  test('treats a missing config value as nothing unlocked', () => {
    expect(getUnlockedPowerupIds(undefined)).toEqual([])
  })
})

describe('parseDemoText', () => {
  test('splits color markup into segments', () => {
    const [line] = parseDemoText('> run [suggestion:&] now')
    expect(line?.dim).toBe(false)
    expect(line?.segments).toEqual([{ text: '> run ' }, { text: '&', color: 'suggestion' }, { text: ' now' }])
  })

  test('marks hash-prefixed lines as dim and strips the hash', () => {
    const [, line] = parseDemoText('> prompt\n#task started in background')
    expect(line).toEqual({ dim: true, segments: [{ text: 'task started in background' }] })
  })

  test('keeps empty lines as a single empty segment', () => {
    expect(parseDemoText('#')).toEqual([{ dim: true, segments: [{ text: '' }] }])
  })
})
