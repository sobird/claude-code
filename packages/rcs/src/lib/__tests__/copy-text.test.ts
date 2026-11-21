import { describe, expect, test } from 'bun:test'

import { assistantCopyText } from '@/lib/copy-text'

describe('assistantCopyText', () => {
  test('joins text chunks and skips thoughts', () => {
    expect(
      assistantCopyText([
        { type: 'thought', text: 'hmm' },
        { type: 'message', text: 'First.' },
        { type: 'message', text: 'Second.' },
      ]),
    ).toBe('First.\n\nSecond.')
  })

  test('trims blank chunks and surroundings', () => {
    expect(
      assistantCopyText([
        { type: 'message', text: '  hello  ' },
        { type: 'message', text: '   ' },
      ]),
    ).toBe('hello')
  })
})
