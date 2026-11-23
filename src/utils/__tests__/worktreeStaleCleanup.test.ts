import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runWithCwdOverride } from '../cwd.js'
import { cleanupStaleAgentWorktrees } from '../worktree.js'

function git(cwd: string, args: string[]): void {
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' })
}

describe('cleanupStaleAgentWorktrees — untracked files', () => {
  let repo: string

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'stale-wt-'))
    git(repo, ['init'])
    git(repo, ['config', 'user.email', 'test@example.com'])
    git(repo, ['config', 'user.name', 'Test'])
    writeFileSync(join(repo, 'README.md'), 'hello\n')
    git(repo, ['add', 'README.md'])
    git(repo, ['commit', '-m', 'init'])
    // Give the repo a remote ref so `rev-list HEAD --not --remotes` is empty.
    git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
  })

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  function addStaleWorktree(slug: string): string {
    const path = join(repo, '.claude', 'worktrees', slug)
    git(repo, ['worktree', 'add', '-b', `worktree-${slug}`, path, 'HEAD'])
    return path
  }

  function ageOut(path: string): void {
    const old = new Date(Date.now() - 60 * 60 * 1000)
    utimesSync(path, old, old)
  }

  test('a worktree holding untracked files is kept', async () => {
    const withUntracked = addStaleWorktree('agent-a1234567')
    writeFileSync(join(withUntracked, 'notes.txt'), 'unsaved work\n')
    ageOut(withUntracked)

    const removed = await runWithCwdOverride(repo, () => cleanupStaleAgentWorktrees(new Date()))

    expect(removed).toBe(0)
    expect(existsSync(withUntracked)).toBe(true)
  })

  test('a clean stale worktree is still removed', async () => {
    const clean = addStaleWorktree('agent-a7654321')
    ageOut(clean)

    const removed = await runWithCwdOverride(repo, () => cleanupStaleAgentWorktrees(new Date()))

    expect(removed).toBe(1)
    expect(existsSync(clean)).toBe(false)
  })
})
