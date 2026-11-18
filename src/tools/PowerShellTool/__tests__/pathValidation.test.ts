import { describe, expect, test } from 'bun:test'

import { getEmptyToolPermissionContext } from '../../../Tool.js'
import type { ParsedPowerShellCommand, RawCommandElement, RawStatement } from '../../../utils/powershell/parser.js'
import { transformStatement } from '../../../utils/powershell/parser.js'
import { checkPathConstraints } from '../pathValidation.js'

const WORKING_DIR_MESSAGE = 'would delete the working directory'

function parseCommand(command: string, target: string, ...flags: string[]): ParsedPowerShellCommand {
  const commandElements: RawCommandElement[] = [
    { type: 'StringConstantExpressionAst', text: 'Remove-Item', value: 'Remove-Item' },
    { type: 'StringConstantExpressionAst', text: target, value: target },
    ...flags.map((flag) => ({ type: 'CommandParameterAst', text: flag })),
  ]
  const raw: RawStatement = {
    type: 'PipelineAst',
    text: command,
    elements: [{ type: 'CommandAst', text: command, commandElements }],
  }
  return {
    valid: true,
    errors: [],
    statements: [transformStatement(raw)],
    variables: [],
    hasStopParsing: false,
    originalCommand: command,
  }
}

function check(command: string, target: string, ...flags: string[]) {
  return checkPathConstraints({ command }, parseCommand(command, target, ...flags), getEmptyToolPermissionContext())
}

describe('checkPathConstraints Remove-Item -Recurse working-directory guard', () => {
  test('asks before recursing into the working directory', () => {
    const result = check('Remove-Item . -Recurse', '.', '-Recurse')

    expect(result.behavior).toBe('ask')
    expect(result.message ?? '').toContain(WORKING_DIR_MESSAGE)
  })

  test('accepts abbreviated -Recurse parameter names', () => {
    const result = check('Remove-Item . -Rec', '.', '-Rec')

    expect(result.behavior).toBe('ask')
    expect(result.message ?? '').toContain(WORKING_DIR_MESSAGE)
  })

  test('does not apply the guard without -Recurse', () => {
    const result = check('Remove-Item .', '.')

    expect(result.message ?? '').not.toContain(WORKING_DIR_MESSAGE)
  })

  test('does not apply the guard to a subdirectory of the working directory', () => {
    const result = check('Remove-Item build -Recurse', 'build', '-Recurse')

    expect(result.message ?? '').not.toContain(WORKING_DIR_MESSAGE)
  })

  test('does not apply the guard to non Remove-Item cmdlets', () => {
    const raw: RawStatement = {
      type: 'PipelineAst',
      text: 'Copy-Item . -Recurse',
      elements: [
        {
          type: 'CommandAst',
          text: 'Copy-Item . -Recurse',
          commandElements: [
            { type: 'StringConstantExpressionAst', text: 'Copy-Item', value: 'Copy-Item' },
            { type: 'StringConstantExpressionAst', text: '.', value: '.' },
            { type: 'CommandParameterAst', text: '-Recurse' },
          ],
        },
      ],
    }
    const parsed: ParsedPowerShellCommand = {
      valid: true,
      errors: [],
      statements: [transformStatement(raw)],
      variables: [],
      hasStopParsing: false,
      originalCommand: raw.text,
    }

    const result = checkPathConstraints({ command: raw.text }, parsed, getEmptyToolPermissionContext())

    expect(result.message ?? '').not.toContain(WORKING_DIR_MESSAGE)
  })
})
