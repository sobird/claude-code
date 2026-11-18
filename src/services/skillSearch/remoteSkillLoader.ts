/**
 * Fetches a remote canonical skill's SKILL.md, caching it on disk.
 *
 * Discovery records a URL per slug; the URL scheme selects the transport:
 * `gs://` via `gcloud storage cat`, `s3://` via `aws s3 cp`, and
 * `http(s)://` via fetch. The fetched markdown is written under the config
 * home so repeated invocations in a session (and across sessions) skip the
 * round trip. Remote skills are treated as immutable — there is no TTL.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { logForDebugging } from '../../utils/debug.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'

/** Give up on an HTTP fetch that hangs; remote skills are small. */
const FETCH_TIMEOUT_MS = 10_000

export type RemoteSkillLoadResult = {
  cacheHit: boolean
  latencyMs: number
  /** Absolute path of the materialized SKILL.md. */
  skillPath: string
  content: string
  fileCount?: number
  totalBytes?: number
  fetchMethod?: 'cache' | 'gcloud' | 'aws' | 'http' | 'https'
}

function cacheDir(): string {
  return join(getClaudeConfigHomeDir(), 'remote-skill-cache')
}

function cachePathFor(slug: string): string {
  return join(cacheDir(), `${encodeURIComponent(slug)}.md`)
}

async function downloadGs(url: string): Promise<string> {
  const result = await execFileNoThrowWithCwd('gcloud', ['storage', 'cat', url])
  if (result.code !== 0) {
    throw new Error(`gcloud storage cat failed (exit ${result.code})`)
  }
  return result.stdout
}

async function downloadS3(url: string): Promise<string> {
  const result = await execFileNoThrowWithCwd('aws', ['s3', 'cp', url, '-'])
  if (result.code !== 0) {
    throw new Error(`aws s3 cp failed (exit ${result.code})`)
  }
  return result.stdout
}

async function downloadHttp(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching remote skill`)
    }
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

async function download(url: string): Promise<{ content: string; fetchMethod: RemoteSkillLoadResult['fetchMethod'] }> {
  if (url.startsWith('gs://')) {
    return { content: await downloadGs(url), fetchMethod: 'gcloud' }
  }
  if (url.startsWith('s3://')) {
    return { content: await downloadS3(url), fetchMethod: 'aws' }
  }
  if (url.startsWith('https://')) {
    return { content: await downloadHttp(url), fetchMethod: 'https' }
  }
  if (url.startsWith('http://')) {
    return { content: await downloadHttp(url), fetchMethod: 'http' }
  }
  throw new Error('Unsupported remote skill URL scheme')
}

export async function loadRemoteSkill(slug: string, url: string): Promise<RemoteSkillLoadResult> {
  const start = Date.now()
  const skillPath = cachePathFor(slug)

  const cached = await readFile(skillPath, 'utf8').catch(() => null)
  if (cached !== null && cached.length > 0) {
    return {
      cacheHit: true,
      latencyMs: Date.now() - start,
      skillPath,
      content: cached,
      fileCount: 1,
      totalBytes: Buffer.byteLength(cached, 'utf8'),
      fetchMethod: 'cache',
    }
  }

  const { content, fetchMethod } = await download(url)
  if (content.trim().length === 0) {
    throw new Error('Remote skill is empty')
  }

  try {
    await mkdir(cacheDir(), { recursive: true })
    await writeFile(skillPath, content, { mode: 0o600 })
  } catch (error) {
    // Cache write failures only cost a future refetch — never the invocation.
    logForDebugging(`[remote-skill] cache write failed for ${slug}: ${String(error)}`)
  }

  return {
    cacheHit: false,
    latencyMs: Date.now() - start,
    skillPath,
    content,
    fileCount: 1,
    totalBytes: Buffer.byteLength(content, 'utf8'),
    fetchMethod,
  }
}
