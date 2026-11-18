import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { logForDebugging } from './debug.js'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'

/** Marker used both to recognise our own hook and to keep the script idempotent. */
const HOOK_MARKER = '# claude-code-attribution-hook'

/**
 * `prepare-commit-msg` hook that appends the co-authorship trailer to the
 * message file. Git runs it before the editor opens, so the trailer survives
 * `-m`, `-F`, and interactive commits alike. The `grep` guard keeps repeated
 * invocation (e.g. `commit --amend`) from stacking duplicates.
 */
const HOOK_SCRIPT = `#!/bin/sh
${HOOK_MARKER}
# Appends a co-authorship trailer unless one is already present.
commit_msg_file="$1"
if [ -z "$commit_msg_file" ] || [ ! -f "$commit_msg_file" ]; then
  exit 0
fi
if grep -q "Co-Authored-By: Claude" "$commit_msg_file"; then
  exit 0
fi
printf '\\nCo-Authored-By: Claude <noreply@anthropic.com>\\n' >> "$commit_msg_file"
`

/**
 * Resolve the hooks directory for a repo. `git rev-parse --git-path hooks`
 * echoes an absolute `core.hooksPath` verbatim when one is configured (the
 * worktree setup relies on this), otherwise it returns a path relative to the
 * repo root.
 */
async function resolveHooksDir(worktreePath: string): Promise<string | null> {
  const result = await execFileNoThrowWithCwd('git', ['rev-parse', '--git-path', 'hooks'], {
    cwd: worktreePath,
  })
  const gitPath = result.stdout.trim()
  if (result.code !== 0 || gitPath.length === 0) {
    return null
  }
  return isAbsolute(gitPath) ? gitPath : join(worktreePath, gitPath)
}

/**
 * Install the attribution `prepare-commit-msg` hook into a repo or worktree.
 *
 * Idempotent: if our hook is already there we do nothing. If some *other*
 * `prepare-commit-msg` hook is present we leave it alone rather than clobbering
 * the user's setup — the hook is an enhancement, not a requirement.
 *
 * `worktreeHooksDir`, when supplied, wins over git's resolution — worktree
 * creation passes the worktree-local `.husky` because the shared
 * `core.hooksPath` points at the main checkout.
 */
export async function installPrepareCommitMsgHook(worktreePath: string, worktreeHooksDir?: string): Promise<void> {
  const hooksDir = worktreeHooksDir ?? (await resolveHooksDir(worktreePath))
  if (hooksDir === null) {
    return
  }

  const hookPath = join(hooksDir, 'prepare-commit-msg')
  const existing = await readFile(hookPath, 'utf8').catch(() => null)
  if (existing !== null) {
    if (!existing.includes(HOOK_MARKER)) {
      logForDebugging(`prepare-commit-msg hook already exists at ${hookPath}; leaving it untouched`)
    }
    return
  }

  await mkdir(hooksDir, { recursive: true })
  await writeFile(hookPath, HOOK_SCRIPT, { mode: 0o755 })
  // writeFile's mode is masked by the umask; chmod guarantees the hook is
  // executable so git will actually run it.
  await chmod(hookPath, 0o755)
  logForDebugging(`Installed attribution prepare-commit-msg hook at ${hookPath}`)
}
