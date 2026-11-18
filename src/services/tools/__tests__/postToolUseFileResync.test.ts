import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FileStateCache } from '../../../utils/fileStateCache.js'
import { resyncReadFileStateAfterPostToolUseHooks } from '../postToolUseFileResync.js'

const tempDirs: string[] = []

function makeTempFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'resync-test-'))
  tempDirs.push(dir)
  const file = join(dir, 'app.ts')
  writeFileSync(file, content)
  return file
}

function makeCache(): FileStateCache {
  return new FileStateCache(100, 25 * 1024 * 1024)
}

function primeCache(cache: FileStateCache, file: string, content: string): void {
  cache.set(file, {
    content,
    timestamp: Math.floor(statSync(file).mtimeMs),
    offset: undefined,
    limit: undefined,
  })
}

function bumpMtime(file: string, secondsFromNow: number): void {
  const future = new Date(Date.now() + secondsFromNow * 1000)
  utimesSync(file, future, future)
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('resyncReadFileStateAfterPostToolUseHooks', () => {
  test('ignores tools other than Edit and Write', () => {
    const file = makeTempFile('before')
    const cache = makeCache()
    primeCache(cache, file, 'before')
    writeFileSync(file, 'after')
    bumpMtime(file, 2)

    expect(resyncReadFileStateAfterPostToolUseHooks('Bash', 'tool-1', { file_path: file }, cache)).toBeNull()
  })

  test('ignores files without a prior read entry', () => {
    const file = makeTempFile('before')
    const cache = makeCache()
    writeFileSync(file, 'after')
    bumpMtime(file, 2)

    expect(resyncReadFileStateAfterPostToolUseHooks('Edit', 'tool-1', { file_path: file }, cache)).toBeNull()
  })

  test('ignores partial reads', () => {
    const file = makeTempFile('before')
    const cache = makeCache()
    cache.set(file, {
      content: 'before',
      timestamp: Math.floor(statSync(file).mtimeMs),
      offset: 10,
      limit: 5,
    })
    writeFileSync(file, 'after')
    bumpMtime(file, 2)

    expect(resyncReadFileStateAfterPostToolUseHooks('Edit', 'tool-1', { file_path: file }, cache)).toBeNull()
  })

  test('re-syncs an entry when a hook rewrote the file', () => {
    const file = makeTempFile('before')
    const cache = makeCache()
    primeCache(cache, file, 'before')
    writeFileSync(file, 'after ')
    bumpMtime(file, 2)

    const message = resyncReadFileStateAfterPostToolUseHooks('Edit', 'tool-1', { file_path: file }, cache)

    const attachment = message?.attachment as { type: string; content: string[] } | undefined
    expect(attachment?.type).toBe('hook_additional_context')
    const text = attachment?.content.join('\n') ?? ''
    expect(text).toContain(file)
    expect(text).toContain('likely a formatter')
    expect(cache.get(file)?.content).toBe('after ')
    expect(cache.get(file)?.timestamp).toBe(Math.floor(statSync(file).mtimeMs))
  })

  test('refreshes the timestamp without a message when content is unchanged', () => {
    const file = makeTempFile('same')
    const cache = makeCache()
    primeCache(cache, file, 'same')
    bumpMtime(file, 2)

    const message = resyncReadFileStateAfterPostToolUseHooks('Write', 'tool-1', { file_path: file }, cache)

    expect(message).toBeNull()
    expect(cache.get(file)?.timestamp).toBe(Math.floor(statSync(file).mtimeMs))
  })
})
