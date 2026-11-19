import { describe, expect, test } from 'bun:test'

import { FORK_BOILERPLATE_TAG, FORK_DIRECTIVE_PREFIX } from '../../../constants/xml.js'
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../../types/command.js'
import type { Message } from '../../../types/message.js'
import { buildForkPromptMessages, call, forkDescription, formatForkStarted, parseForkDirective } from '../fork.js'
import forkCommand from '../index.js'

function textOf(message: Message): string {
  if (message.type !== 'user') throw new Error(`expected a user message, got ${message.type}`)
  const content = message.message.content
  if (typeof content === 'string') return content
  return content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

function capturingOnDone(): { onDone: LocalJSXCommandOnDone; calls: Array<{ result?: string; display?: string }> } {
  const calls: Array<{ result?: string; display?: string }> = []
  const onDone: LocalJSXCommandOnDone = (result, options) => {
    calls.push({ result, display: options?.display })
  }
  return { onDone, calls }
}

describe('parseForkDirective', () => {
  test('trims surrounding whitespace', () => {
    expect(parseForkDirective('  refactor the parser  ')).toBe('refactor the parser')
  })

  test('returns null for an empty or whitespace-only directive', () => {
    expect(parseForkDirective('')).toBeNull()
    expect(parseForkDirective('   \n\t ')).toBeNull()
  })

  test('keeps multi-line directives intact apart from trimming', () => {
    expect(parseForkDirective('  line one\nline two  ')).toBe('line one\nline two')
  })
})

describe('forkDescription', () => {
  test('passes a short directive through unchanged', () => {
    expect(forkDescription('summarize the diff')).toBe('summarize the diff')
  })

  test('truncates a long directive to 60 characters with an ellipsis', () => {
    const long = 'a'.repeat(200)
    const description = forkDescription(long)
    expect(description.length).toBe(60)
    expect(description.endsWith('…')).toBe(true)
    expect(description.startsWith('a'.repeat(59))).toBe(true)
  })
})

describe('formatForkStarted', () => {
  test('names the worker and says it runs in the background', () => {
    const text = formatForkStarted('a1234', 'summarize the diff')
    expect(text).toContain('a1234')
    expect(text).toContain('summarize the diff')
    expect(text).toContain('background')
  })
})

describe('buildForkPromptMessages', () => {
  test('wraps the directive in the fork boilerplate as a single user message', () => {
    const messages = buildForkPromptMessages('run the tests')
    expect(messages).toHaveLength(1)

    const [message] = messages
    expect(message.type).toBe('user')
    const text = textOf(message)
    expect(text).toContain(`<${FORK_BOILERPLATE_TAG}>`)
    expect(text).toContain(`${FORK_DIRECTIVE_PREFIX}run the tests`)
  })
})

describe('/fork command', () => {
  const allow: LocalJSXCommandContext['canUseTool'] = (async () => ({
    behavior: 'allow',
  })) as unknown as LocalJSXCommandContext['canUseTool']

  test('explains the usage and does nothing when no directive is given', async () => {
    const { onDone, calls } = capturingOnDone()

    const result = await call(onDone, {} as unknown as LocalJSXCommandContext, '   ')

    expect(result).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.result).toBe('Usage: /fork <directive>')
    expect(calls[0]?.display).toBe('system')
  })

  test('refuses to fork when the session has no permission handler', async () => {
    const { onDone, calls } = capturingOnDone()

    const result = await call(onDone, {} as unknown as LocalJSXCommandContext, 'run the tests')

    expect(result).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.result).toContain('permission')
    expect(calls[0]?.display).toBe('system')
  })

  test('reports that fork is unavailable when the experiment is off', async () => {
    const { onDone, calls } = capturingOnDone()

    // FORK_SUBAGENT is not enabled under the test build, so this exercises the
    // availability guard rather than spawning a worker.
    const result = await call(onDone, { canUseTool: allow } as unknown as LocalJSXCommandContext, 'run the tests')

    expect(result).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.result).toContain('not available')
    expect(calls[0]?.display).toBe('system')
  })

  test('registers as a local-jsx /fork command', () => {
    expect(forkCommand.name).toBe('fork')
    expect(forkCommand.type).toBe('local-jsx')
    expect(forkCommand.description.toLowerCase()).toContain('fork')
    expect(forkCommand.argumentHint).toBe('<directive>')
  })
})
