import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { clearResolveGitDirCache, getGitWorktreeName } from '../gitFilesystem.js'

function git(cwd: string, args: string[]): void {
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' })
}

describe('getGitWorktreeName', () => {
  let repo: string

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'wt-name-'))
    git(repo, ['init'])
    git(repo, ['config', 'user.email', 'test@example.com'])
    git(repo, ['config', 'user.name', 'Test'])
    writeFileSync(join(repo, 'README.md'), 'hello\n')
    git(repo, ['add', 'README.md'])
    git(repo, ['commit', '-m', 'init'])
  })

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true })
    clearResolveGitDirCache()
  })

  test('a normal repo has no worktree name', async () => {
    expect(await getGitWorktreeName(repo)).toBeNull()
  })

  test('a linked worktree reports its name', async () => {
    const wtPath = join(repo, '.claude', 'worktrees', 'agent-abc1234')
    git(repo, ['worktree', 'add', '-b', 'worktree-agent-abc1234', wtPath, 'HEAD'])
    expect(await getGitWorktreeName(wtPath)).toBe(basename(wtPath))
  })

  test('a path outside any repo has no worktree name', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'wt-none-'))
    try {
      expect(await getGitWorktreeName(outside)).toBeNull()
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
