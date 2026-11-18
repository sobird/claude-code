import { describe, expect, test } from 'bun:test'

import { checkPathSafetyForAutoEdit } from '../filesystem.js'

function check(path: string) {
  return checkPathSafetyForAutoEdit(path, [path])
}

describe('checkPathSafetyForAutoEdit protected directories', () => {
  test('treats .husky as a protected directory', () => {
    expect(check('/repo/.husky/pre-commit').safe).toBe(false)
    expect(check('/repo/.HUSKY/pre-commit').safe).toBe(false)
  })

  test('still protects the pre-existing protected directories', () => {
    expect(check('/repo/.git/config').safe).toBe(false)
    expect(check('/repo/.vscode/settings.json').safe).toBe(false)
    expect(check('/repo/.claude/settings.json').safe).toBe(false)
  })

  test('allows ordinary project files', () => {
    expect(check('/repo/src/index.ts').safe).toBe(true)
  })
})
