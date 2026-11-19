import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import workflows from '../index.js'
import { formatWorkflowList } from '../workflows.js'

describe('formatWorkflowList', () => {
  const root = mkdtempSync(join(tmpdir(), 'workflows-'))
  const workflowDir = join(root, '.claude', 'workflows')

  beforeAll(() => {
    mkdirSync(workflowDir, { recursive: true })
    writeFileSync(
      join(workflowDir, 'build.yaml'),
      'name: Build & Test\ndescription: Compile and run tests\nsteps:\n  - command: bun run build\n  - prompt: review output\n',
    )
    writeFileSync(
      join(workflowDir, 'deploy.json'),
      JSON.stringify({ name: 'deploy', steps: [{ command: 'gcloud deploy' }] }),
    )
    writeFileSync(join(workflowDir, 'notes.txt'), 'not a workflow')
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('lists definitions with step counts and skips non-workflow files', async () => {
    const text = await formatWorkflowList(root)
    expect(text).toContain('NAME')
    expect(text).toContain('STEPS')
    expect(text).toContain('Build & Test')
    expect(text).toContain('Compile and run tests')
    expect(text).toContain('deploy')
    expect(text).not.toContain('notes')
    // Build & Test has two steps, deploy has one.
    expect(text).toMatch(/Build & Test\s+2\b/)
    expect(text).toMatch(/deploy\s+1\b/)
    expect(text).toContain('/workflow-')
  })

  test('explains where definitions live when there are none', async () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'workflows-empty-'))
    try {
      const text = await formatWorkflowList(emptyRoot)
      expect(text).toContain('No workflows found')
      expect(text).toContain(join('.claude', 'workflows'))
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true })
    }
  })

  test('registers as /workflows', () => {
    expect(workflows.name).toBe('workflows')
    expect(workflows.type).toBe('local')
    expect(workflows.description).toContain('workflow')
  })
})
