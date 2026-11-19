import { expect, test } from 'bun:test'

import { commandNamesInSourceFile } from '../srcCommands'

test('reads commands through as const and property reordering', () => {
  const text = [
    'export const a = { type: "local" as const, name: "alpha" }',
    'export const b = { name: "beta", type: "prompt" }',
    'export const c = { type: "local-jsx", name: "gamma", description: "x" }',
  ].join('\n')
  expect(commandNamesInSourceFile('demo.ts', text)).toEqual(['alpha', 'beta', 'gamma'])
})

test('ignores objects without a command type or literal name', () => {
  const text = [
    'const tool = { name: "Bash" }',
    'const dyn = { type: "prompt", name: "mcp__" + server }',
    'const notLiteral = { type: commandType, name: "x" }',
  ].join('\n')
  expect(commandNamesInSourceFile('demo.ts', text)).toEqual([])
})
