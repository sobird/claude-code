import { describe, expect, test } from 'bun:test'

import { acceptCommand, commandQuery, filterCommands, moveIndex } from '@/lib/command-menu'

describe('commandQuery', () => {
  test('returns the token after a leading slash', () => {
    expect(commandQuery('/co')).toBe('co')
    expect(commandQuery('/compact')).toBe('compact')
  })

  test('an empty query after the slash still opens the menu', () => {
    expect(commandQuery('/')).toBe('')
  })

  test('only inspects text before the caret', () => {
    expect(commandQuery('/co mpact', 3)).toBe('co')
  })

  test('ignores text that does not start with a slash', () => {
    expect(commandQuery('hi /co')).toBeNull()
    expect(commandQuery('/compact now')).toBeNull()
    expect(commandQuery('')).toBeNull()
  })

  test('whitespace before the caret closes the menu', () => {
    expect(commandQuery('/co ')).toBeNull()
    expect(commandQuery('/compact arg', 10)).toBeNull()
  })

  test('an accepted command keeps the menu closed', () => {
    expect(commandQuery(acceptCommand('co'))).toBeNull()
  })
})

describe('filterCommands', () => {
  const commands = ['compact', 'clear', 'cost', 'summary', 'config']

  test('prefix matches case-insensitively and preserves order', () => {
    expect(filterCommands(commands, 'co')).toEqual(['compact', 'cost', 'config'])
    expect(filterCommands(commands, 'CO')).toEqual(['compact', 'cost', 'config'])
  })

  test('an empty query lists the leading entries, capped by the limit', () => {
    expect(filterCommands(commands, '', 2)).toEqual(['compact', 'clear'])
  })

  test('defaults to eight results', () => {
    const many = Array.from({ length: 20 }, (_, index) => `cmd${index}`)
    expect(filterCommands(many, '')).toHaveLength(8)
  })

  test('deduplicates names and drops non-matches', () => {
    expect(filterCommands(['cost', 'cost', 'clear'], 'co')).toEqual(['cost'])
  })

  test('accepts command names that already carry a slash', () => {
    expect(filterCommands(['/compact', '/clear'], 'cl')).toEqual(['/clear'])
  })
})

describe('moveIndex', () => {
  test('moves down and wraps at the end', () => {
    expect(moveIndex(0, 1, 3)).toBe(1)
    expect(moveIndex(2, 1, 3)).toBe(0)
  })

  test('moves up and wraps at the start', () => {
    expect(moveIndex(2, -1, 3)).toBe(1)
    expect(moveIndex(0, -1, 3)).toBe(2)
  })

  test('an empty list always yields 0', () => {
    expect(moveIndex(0, 1, 0)).toBe(0)
    expect(moveIndex(5, -1, 0)).toBe(0)
  })
})

describe('acceptCommand', () => {
  test('inserts a leading slash and a trailing space', () => {
    expect(acceptCommand('compact')).toBe('/compact ')
  })

  test('does not double the slash when the name already has one', () => {
    expect(acceptCommand('/compact')).toBe('/compact ')
  })
})
