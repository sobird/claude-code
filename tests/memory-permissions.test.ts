import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { join, sep } from 'node:path'

import { getMemoryBaseDir } from '../src/memdir/paths.js'
import {
  getAgentMemoryDir,
  getAgentMemoryEntrypoint,
  getMemoryScopeDisplay,
  isAgentMemoryPath,
} from '../src/tools/AgentTool/agentMemory.js'
import { getCwd } from '../src/utils/cwd.js'

// R36: pin the already-present agent/skill memory permission behavior without
// touching src/. The bundled-skill 0o700/0o600 modes and the Read/Write
// permission bypasses live in unexported internals, so they are covered by
// static bundle evidence (see docs/upgrade/2.1.89/notes.md). This file covers
// the path/scoping helpers that drive those bypasses.
const REMOTE_MEMORY_ENV = 'CLAUDE_CODE_REMOTE_MEMORY_DIR'
let savedRemoteMemoryDir: string | undefined

beforeAll(() => {
  savedRemoteMemoryDir = process.env[REMOTE_MEMORY_ENV]
})

beforeEach(() => {
  // Local scope is cwd-based only when the remote memory mount is unset.
  delete process.env[REMOTE_MEMORY_ENV]
})

afterAll(() => {
  if (savedRemoteMemoryDir === undefined) {
    delete process.env[REMOTE_MEMORY_ENV]
  } else {
    process.env[REMOTE_MEMORY_ENV] = savedRemoteMemoryDir
  }
})

describe('getAgentMemoryDir', () => {
  test('project scope is cwd-based and sanitizes colons in the agent type', () => {
    expect(getAgentMemoryDir('plugin:agent', 'project')).toBe(
      join(getCwd(), '.claude', 'agent-memory', 'plugin-agent') + sep,
    )
  })

  test('user scope lives under the memory base dir', () => {
    expect(getAgentMemoryDir('plugin:agent', 'user')).toBe(
      join(getMemoryBaseDir(), 'agent-memory', 'plugin-agent') + sep,
    )
  })

  test('local scope is cwd-based when no remote memory dir is set', () => {
    expect(getAgentMemoryDir('plugin:agent', 'local')).toBe(
      join(getCwd(), '.claude', 'agent-memory-local', 'plugin-agent') + sep,
    )
  })
})

describe('isAgentMemoryPath', () => {
  test('accepts MEMORY.md under all three scopes', () => {
    for (const scope of ['user', 'project', 'local'] as const) {
      expect(isAgentMemoryPath(getAgentMemoryEntrypoint('x', scope))).toBe(true)
    }
  })

  test('rejects unrelated paths', () => {
    expect(isAgentMemoryPath('/etc/passwd')).toBe(false)
  })

  test('rejects .. traversal that escapes the memory directory', () => {
    const escaped = `${getAgentMemoryDir('x', 'project')}..${sep}..${sep}escape${sep}MEMORY.md`
    expect(isAgentMemoryPath(escaped)).toBe(false)
  })
})

describe('agent memory entrypoint and display', () => {
  test('project entrypoint ends with MEMORY.md', () => {
    expect(getAgentMemoryEntrypoint('x', 'project').endsWith('MEMORY.md')).toBe(true)
  })

  test('scope display strings match the source', () => {
    expect(getMemoryScopeDisplay('project')).toBe('Project (.claude/agent-memory/)')
    expect(getMemoryScopeDisplay('user').startsWith('User (')).toBe(true)
    expect(getMemoryScopeDisplay('user').endsWith('agent-memory/)')).toBe(true)
    expect(getMemoryScopeDisplay('local').startsWith('Local (')).toBe(true)
    expect(getMemoryScopeDisplay('local').includes('agent-memory-local')).toBe(true)
  })
})
