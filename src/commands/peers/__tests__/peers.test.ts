import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { spawn, type Subprocess } from 'bun'

import type { LocalJSXCommandContext } from '../../../types/command.js'
import peers from '../index.js'
import { formatPeers } from '../peers.js'

const AT = Date.parse('2026-11-20T12:00:00Z')

describe('formatPeers', () => {
  test('says so when there are no peers', () => {
    expect(formatPeers([])).toBe('No other Claude Code sessions are running.')
  })

  test('renders name, kind, pid, short session ID and cwd', () => {
    const text = formatPeers([
      {
        pid: 4242,
        kind: 'bg',
        name: 'nightly',
        sessionId: '11111111-2222-3333-4444-555555555555',
        cwd: '/repo',
        startedAt: AT,
      },
    ])
    expect(text).toContain('NAME')
    expect(text).toContain('nightly')
    expect(text).toContain('bg')
    expect(text).toContain('4242')
    expect(text).toContain('11111111')
    expect(text).toContain('/repo')
  })

  test('falls back to the pid when a peer has no name or session ID', () => {
    expect(formatPeers([{ pid: 777 }])).toContain('pid 777')
  })
})

describe('/peers command', () => {
  const root = mkdtempSync(join(tmpdir(), 'peers-'))
  const configDir = join(root, 'config')
  const sessionsDir = join(configDir, 'sessions')
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  const children: Subprocess[] = []

  beforeAll(() => {
    mkdirSync(sessionsDir, { recursive: true })
    process.env.CLAUDE_CONFIG_DIR = configDir
  })

  afterAll(() => {
    for (const child of children) child.kill()
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    rmSync(root, { recursive: true, force: true })
  })

  function spawnSleep(): number {
    const child = spawn(['sleep', '30'])
    children.push(child)
    return child.pid
  }

  function writeSession(pid: number, data: Record<string, unknown>): void {
    writeFileSync(join(sessionsDir, `${pid}.json`), JSON.stringify(data))
  }

  test('lists live peers and skips this session and dead pids', async () => {
    const livePid = spawnSleep()
    writeSession(livePid, {
      sessionId: 'aaaaaaaa-1111-2222-3333-444444444444',
      kind: 'bg',
      name: 'nightly',
      cwd: '/repo',
      startedAt: Date.now(),
    })
    writeSession(process.pid, { sessionId: 'self', name: 'self-session' })
    writeSession(999_999, { sessionId: 'ghost', name: 'ghost' })

    const { call } = await peers.load()
    const result = await call('', {} as LocalJSXCommandContext)

    expect(result.type).toBe('text')
    if (result.type !== 'text') throw new Error(`unexpected result type: ${result.type}`)
    expect(result.value).toContain('nightly')
    expect(result.value).toContain(String(livePid))
    expect(result.value).not.toContain('self-session')
    expect(result.value).not.toContain('ghost')
  })

  test('registers as /peers', () => {
    expect(peers.name).toBe('peers')
    expect(peers.type).toBe('local')
    expect(peers.description).toContain('sessions')
  })
})
