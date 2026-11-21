import { describe, expect, test } from 'bun:test'

import {
  editableRule,
  permissionOptions,
  type PermissionSuggestion,
  withRuleContent,
} from '@/lib/permission-suggestions'

function kinds(suggestions: PermissionSuggestion[]) {
  return permissionOptions(suggestions).map((option) => option.kind)
}

describe('permissionOptions', () => {
  test('an empty suggestion list offers only allow-once', () => {
    expect(permissionOptions([])).toEqual([{ id: 'allow-once', kind: 'allow-once', suggestionIndex: null }])
  })

  test('addRules to session becomes allow-session', () => {
    const suggestions: PermissionSuggestion[] = [
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'npm run:*' }],
        behavior: 'allow',
        destination: 'session',
      },
    ]
    expect(permissionOptions(suggestions)).toEqual([
      { id: 'allow-once', kind: 'allow-once', suggestionIndex: null },
      {
        id: 'allow-session-0',
        kind: 'allow-session',
        suggestionIndex: 0,
        rules: [{ toolName: 'Bash', ruleContent: 'npm run:*' }],
        destination: 'session',
      },
    ])
  })

  test('addRules to a settings destination becomes allow-always', () => {
    expect(
      kinds([
        {
          type: 'addRules',
          rules: [{ toolName: 'Read', ruleContent: '/tmp/**' }],
          behavior: 'allow',
          destination: 'localSettings',
        },
      ]),
    ).toEqual(['allow-once', 'allow-always'])
  })

  test('a deny rule becomes always-deny', () => {
    expect(
      kinds([
        {
          type: 'addRules',
          rules: [{ toolName: 'Bash', ruleContent: 'rm:*' }],
          behavior: 'deny',
          destination: 'session',
        },
      ]),
    ).toEqual(['allow-once', 'always-deny'])
  })

  test('setMode acceptEdits becomes accept-edits', () => {
    const options = permissionOptions([{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }])
    expect(options[1]).toMatchObject({ kind: 'accept-edits', mode: 'acceptEdits', destination: 'session' })
  })

  test('addDirectories becomes allow-directories', () => {
    const options = permissionOptions([{ type: 'addDirectories', directories: ['/repo'], destination: 'session' }])
    expect(options[1]).toMatchObject({ kind: 'allow-directories', directories: ['/repo'] })
  })

  test('unknown suggestions stay selectable as apply-suggestion', () => {
    expect(kinds([{ type: 'someFutureUpdate' }])).toEqual(['allow-once', 'apply-suggestion'])
  })

  test('duplicate suggestions are collapsed', () => {
    const suggestion: PermissionSuggestion = {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'npm run:*' }],
      behavior: 'allow',
      destination: 'session',
    }
    expect(kinds([suggestion, { ...suggestion }])).toEqual(['allow-once', 'allow-session'])
  })

  test('the suggestion index still points at the original entry after dedupe', () => {
    const first: PermissionSuggestion = {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }],
      behavior: 'allow',
      destination: 'session',
    }
    const options = permissionOptions([
      first,
      { ...first },
      { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
    ])
    expect(options.map((option) => option.suggestionIndex)).toEqual([null, 0, 2])
  })
})

describe('editableRule', () => {
  test('a single allow rule is editable', () => {
    const suggestion: PermissionSuggestion = {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }],
      behavior: 'allow',
      destination: 'session',
    }
    expect(editableRule(suggestion)).toEqual({ toolName: 'Bash', ruleContent: 'npm test:*' })
  })

  test('a rule without content starts empty', () => {
    const suggestion: PermissionSuggestion = { type: 'addRules', rules: [{ toolName: 'Read' }], behavior: 'allow' }
    expect(editableRule(suggestion)).toEqual({ toolName: 'Read', ruleContent: '' })
  })

  test('multiple rules, deny rules, and non-addRules are not editable', () => {
    expect(
      editableRule({
        type: 'addRules',
        rules: [
          { toolName: 'Bash', ruleContent: 'a' },
          { toolName: 'Read', ruleContent: 'b' },
        ],
        behavior: 'allow',
      }),
    ).toBeNull()
    expect(
      editableRule({ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'rm:*' }], behavior: 'deny' }),
    ).toBeNull()
    expect(editableRule({ type: 'setMode', mode: 'acceptEdits' })).toBeNull()
    expect(editableRule({ type: 'addRules', rules: [], behavior: 'allow' })).toBeNull()
  })
})

describe('withRuleContent', () => {
  const suggestion: PermissionSuggestion = {
    type: 'addRules',
    rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }],
    behavior: 'allow',
    destination: 'session',
  }

  test('replaces the rule content without modifying the original', () => {
    const edited = withRuleContent(suggestion, '  npm run test:*  ')
    expect(edited).toEqual({
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'npm run test:*' }],
      behavior: 'allow',
      destination: 'session',
    })
    expect(edited).not.toBe(suggestion)
    expect(suggestion.rules?.[0]?.ruleContent).toBe('npm test:*')
  })

  test('an empty value drops the rule content', () => {
    const edited = withRuleContent(suggestion, '   ')
    expect(edited.rules).toEqual([{ toolName: 'Bash' }])
  })
})
