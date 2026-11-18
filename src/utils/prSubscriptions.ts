import * as fs from 'node:fs'
import * as path from 'node:path'

import { detectCurrentRepositoryWithHost } from './detectRepository.js'
import { getClaudeConfigHomeDir } from './envUtils.js'

/**
 * File-backed store for GitHub PR webhook subscriptions.
 *
 * The KAIROS_GITHUB_WEBHOOKS feature gates a `/subscribe-pr` command and the
 * SubscribePR tool on this store. Webhook delivery itself happens in the
 * KAIROS/CCR runtime; this module only records which PRs the user asked to
 * follow so the client and any server-side routing can agree on the set.
 */
export type PRSubscription = {
  repo: string // "owner/repo"
  prNumber: number
  subscribedAt: string // ISO 8601
}

export type ParsedPRReference = { repo: string; prNumber: number } | { error: string }

const SUBSCRIPTIONS_FILENAME = 'pr-subscriptions.json'
const REPO_PATTERN = /^[^/\s]+\/[^/\s]+$/

export function getPRSubscriptionsFilePath(): string {
  return path.join(getClaudeConfigHomeDir(), SUBSCRIPTIONS_FILENAME)
}

function isPRSubscription(value: unknown): value is PRSubscription {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.repo === 'string' &&
    REPO_PATTERN.test(entry.repo) &&
    typeof entry.prNumber === 'number' &&
    Number.isInteger(entry.prNumber) &&
    entry.prNumber > 0 &&
    typeof entry.subscribedAt === 'string'
  )
}

export function listPRSubscriptions(): PRSubscription[] {
  try {
    const raw = fs.readFileSync(getPRSubscriptionsFilePath(), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isPRSubscription) : []
  } catch {
    return []
  }
}

function writePRSubscriptions(subscriptions: PRSubscription[]): void {
  const filePath = getPRSubscriptionsFilePath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(subscriptions, null, 2), 'utf-8')
}

function assertValidPR(repo: string, prNumber: number): void {
  if (!REPO_PATTERN.test(repo)) {
    throw new Error(`Invalid repository "${repo}"; expected owner/repo.`)
  }
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`Invalid PR number "${prNumber}"; expected a positive integer.`)
  }
}

export function addPRSubscription(repo: string, prNumber: number): { added: boolean; subscription: PRSubscription } {
  assertValidPR(repo, prNumber)

  const subscriptions = listPRSubscriptions()
  const existing = subscriptions.find((s) => s.repo === repo && s.prNumber === prNumber)
  if (existing) {
    return { added: false, subscription: existing }
  }

  const subscription: PRSubscription = {
    repo,
    prNumber,
    subscribedAt: new Date().toISOString(),
  }
  writePRSubscriptions([...subscriptions, subscription])
  return { added: true, subscription }
}

export function removePRSubscription(repo: string, prNumber: number): boolean {
  const subscriptions = listPRSubscriptions()
  const remaining = subscriptions.filter((s) => !(s.repo === repo && s.prNumber === prNumber))
  if (remaining.length === subscriptions.length) {
    return false
  }
  writePRSubscriptions(remaining)
  return true
}

function parsePRNumber(raw: string): number | null {
  const prNumber = Number.parseInt(raw, 10)
  return Number.isInteger(prNumber) && prNumber > 0 ? prNumber : null
}

/**
 * Parse a PR URL, an `owner/repo#123` reference, or a bare PR number. A bare
 * number resolves the repository from the current git checkout.
 */
export async function parsePRArg(arg: string): Promise<ParsedPRReference> {
  const trimmed = arg.trim()

  const urlMatch = trimmed.match(/^https?:\/\/[^/]+\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/)
  if (urlMatch) {
    const prNumber = parsePRNumber(urlMatch[2])
    return prNumber ? { repo: urlMatch[1], prNumber } : { error: `Invalid PR number in "${trimmed}".` }
  }

  const shortMatch = trimmed.match(/^([^/\s]+\/[^/\s]+)#(\d+)$/)
  if (shortMatch) {
    const prNumber = parsePRNumber(shortMatch[2])
    return prNumber ? { repo: shortMatch[1], prNumber } : { error: `Invalid PR number in "${trimmed}".` }
  }

  const bareMatch = trimmed.match(/^#?(\d+)$/)
  if (bareMatch) {
    const prNumber = parsePRNumber(bareMatch[1])
    if (!prNumber) {
      return { error: `Invalid PR number in "${trimmed}".` }
    }
    const detected = await detectCurrentRepositoryWithHost()
    if (!detected) {
      return {
        error: 'Could not detect the GitHub repository for the current directory. Provide a full PR URL instead.',
      }
    }
    return { repo: `${detected.owner}/${detected.name}`, prNumber }
  }

  return {
    error: `Unrecognised PR reference: "${trimmed}". Expected a PR URL, owner/repo#123, or a PR number.`,
  }
}
