import axios from 'axios'
import figures from 'figures'
import React, { useEffect, useRef, useState } from 'react'

import { Dialog } from '../../components/design-system/Dialog.js'
import { LoadingState } from '../../components/design-system/LoadingState.js'
import { getOauthConfig } from '../../constants/oauth.js'
import { Box, Text } from '../../ink.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import { logEvent } from '../../services/analytics/index.js'
import {
  checkRemoteAgentEligibility,
  formatPreconditionError,
  getRemoteTaskSessionUrl,
  registerRemoteAgentTask,
} from '../../tasks/RemoteAgentTask/RemoteAgentTask.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { errorMessage } from '../../utils/errors.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { getBranch, getDefaultBranch, gitExe } from '../../utils/git.js'
import { jsonParse } from '../../utils/slowOperations.js'
import { archiveRemoteSession, teleportToRemote } from '../../utils/teleport.js'
import { getOAuthHeaders, prepareApiRequest } from '../../utils/teleport/api.js'

type AutofixContext = Parameters<LocalJSXCommandCall>[1]
type AutofixOnDone = Parameters<LocalJSXCommandCall>[0]

type Phase = 'checking' | 'spawning' | 'subscribing'

const PHASE_MESSAGE: Record<Phase, string> = {
  checking: 'Detecting open PR for current branch…',
  spawning: 'Spawning remote Claude Code session…',
  subscribing: 'Turning on autofix…',
}

const CCR_BYOC_BETA = 'ccr-byoc-2025-07-29'

type GhPrView = { number: number; state: string; url: string }

function parseGhPrView(json: string): GhPrView | null {
  const value: unknown = jsonParse(json)
  if (
    typeof value === 'object' &&
    value !== null &&
    'number' in value &&
    'state' in value &&
    'url' in value &&
    typeof value.number === 'number' &&
    typeof value.state === 'string' &&
    typeof value.url === 'string'
  ) {
    return { number: value.number, state: value.state, url: value.url }
  }
  return null
}

function defaultAutofixPrompt(owner: string, repo: string, prNumber: number): string {
  return `You're monitoring PR #${prNumber} in ${owner}/${repo}. When CI failures or review comments arrive as notifications, investigate and push fixes directly to the PR branch. Start by checking the current PR status.`
}

async function hasUnpushedCommits(): Promise<boolean> {
  const { stdout, code } = await execFileNoThrow(gitExe(), ['rev-list', '--count', '@{u}..HEAD'], {
    preserveOutputOnError: false,
  })
  return code === 0 && Number.parseInt(stdout.trim(), 10) > 0
}

function toCompatSessionId(id: string): string {
  return id.startsWith('cse_') ? `session_${id.slice(4)}` : id
}

/**
 * Turns on the PR autofix subscription for a freshly created remote session.
 * Mirrors the CCR `subscribe-pr` endpoint: 2xx and 409 (already subscribed)
 * both count as success.
 */
async function enableAutofix(sessionId: string, repo: string, prNumber: number, signal: AbortSignal): Promise<boolean> {
  let accessToken: string
  try {
    accessToken = (await prepareApiRequest()).accessToken
  } catch {
    return false
  }
  const url = `${getOauthConfig().BASE_API_URL}/v1/code/github/subscribe-pr`
  const headers = { ...getOAuthHeaders(accessToken), 'anthropic-beta': CCR_BYOC_BETA }
  try {
    const response = await axios.post(
      url,
      { session_id: toCompatSessionId(sessionId), repo, pr_number: prNumber },
      { headers, timeout: 10000, signal, validateStatus: (status) => status < 500 },
    )
    return (response.status >= 200 && response.status < 300) || response.status === 409
  } catch {
    return false
  }
}

function AutofixPrDialog({
  onDone,
  context,
  prompt,
}: {
  onDone: AutofixOnDone
  context: AutofixContext
  prompt: string
}): React.ReactNode {
  const [phase, setPhase] = useState<Phase>('checking')
  const [pr, setPr] = useState<{ ref: string; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const cancelledRef = useRef(false)
  const finishedRef = useRef(false)

  useEffect(() => {
    logEvent('tengu_autofix_pr_started', {})
    const signal = context.abortController.signal

    function fail(message: string): void {
      if (cancelledRef.current) return
      logEvent('tengu_autofix_pr_result', { success: false })
      setError(`Autofix PR failed: ${message}`)
    }

    async function run(): Promise<void> {
      try {
        const [branch, defaultBranch, eligibility, hasUnpushed] = await Promise.all([
          getBranch(),
          getDefaultBranch(),
          checkRemoteAgentEligibility({ skipBundle: true }),
          hasUnpushedCommits(),
        ])
        if (cancelledRef.current) return

        if (branch === defaultBranch) {
          fail(`cannot run on the default branch (${defaultBranch}). Check out a feature branch first.`)
          return
        }
        if (!eligibility.eligible) {
          const reasons = eligibility.errors.map(formatPreconditionError).join('\n')
          fail(`cannot launch remote session —\n${reasons}`)
          return
        }

        const gh = await execFileNoThrow('gh', ['pr', 'view', '--json', 'number,state,url'], {
          timeout: 10000,
          preserveOutputOnError: true,
          abortSignal: signal,
        })
        if (cancelledRef.current) return
        if (gh.code !== 0 || !gh.stdout.trim()) {
          if (gh.error?.includes('ENOENT')) {
            fail('gh CLI is required but not found.')
          } else if (gh.error) {
            fail(`gh pr view failed: ${gh.error}`)
          } else {
            fail(`no open PR found for branch "${branch}". Create a PR first, then retry.`)
          }
          return
        }

        const view = parseGhPrView(gh.stdout)
        if (!view) {
          fail(`no open PR found for branch "${branch}". Create a PR first, then retry.`)
          return
        }
        if (view.state === 'MERGED' || view.state === 'CLOSED') {
          fail(`PR #${view.number} is ${view.state.toLowerCase()}. Autofix requires an open PR.`)
          return
        }
        const urlMatch = view.url.match(/\/([^/]+)\/([^/]+)\/pull\//)
        const owner = urlMatch?.[1]
        const repo = urlMatch?.[2]
        if (!owner || !repo) {
          fail(`unexpected PR URL format: ${view.url}`)
          return
        }
        const prNumber = view.number
        setPr({ ref: `${owner}/${repo}#${prNumber}`, url: view.url })
        setPhase('spawning')

        const initialMessage = prompt || defaultAutofixPrompt(owner, repo, prNumber)
        const session = await teleportToRemote({
          initialMessage,
          branchName: branch,
          reuseOutcomeBranch: branch,
          title: `Autofix PR: ${owner}/${repo}#${prNumber} (${branch})`,
          useDefaultEnvironment: true,
          skipBundle: true,
          signal,
          githubPr: { owner, repo, number: prNumber },
        })
        if (cancelledRef.current) return
        if (!session) {
          fail('remote session creation failed.')
          return
        }
        sessionIdRef.current = session.id
        setPhase('subscribing')

        const subscribed = await enableAutofix(session.id, `${owner}/${repo}`, prNumber, signal)
        if (cancelledRef.current) return

        registerRemoteAgentTask({
          remoteTaskType: 'autofix-pr',
          session: { id: session.id, title: session.title },
          command: initialMessage,
          isLongRunning: true,
          remoteTaskMetadata: { owner, repo, prNumber },
          context: {
            abortController: new AbortController(),
            getAppState: context.getAppState,
            setAppState: context.setAppState,
          },
        })

        const warnings: string[] = []
        if (!subscribed) warnings.push('WARNING: Failed to turn on autofix for this PR')
        if (hasUnpushed) {
          warnings.push('WARNING: You have unpushed local commits, run git push so the remote session sees them')
        }
        const suffix = warnings.length > 0 ? `\n${warnings.join('\n')}` : ''
        const sessionUrl = getRemoteTaskSessionUrl(session.id)

        finishedRef.current = true
        sessionIdRef.current = null
        logEvent('tengu_autofix_pr_result', { success: true })
        onDone(
          `Spawned remote autofix PR session on ${branch} (PR #${prNumber})${suffix}\n  ${figures.arrowRight} ${sessionUrl}`,
        )
      } catch (e) {
        fail(errorMessage(e))
      }
    }

    void run()

    return () => {
      cancelledRef.current = true
      const id = sessionIdRef.current
      sessionIdRef.current = null
      if (id) void archiveRemoteSession(id)
    }
    // onDone/context/prompt are stable for the lifetime of this one-shot dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleCancel(): void {
    if (finishedRef.current) return
    if (error) {
      finishedRef.current = true
      onDone(error)
      return
    }
    cancelledRef.current = true
    context.abortController.abort()
    finishedRef.current = true
    logEvent('tengu_autofix_pr_result', { success: false })
    onDone('Autofix PR cancelled')
  }

  useKeybinding(
    'confirm:yes',
    () => {
      if (error && !finishedRef.current) {
        finishedRef.current = true
        onDone(error)
      }
    },
    { context: 'Confirmation', isActive: error !== null },
  )

  return (
    <Dialog
      title="Autofix PR"
      subtitle="Spawn a remote Claude Code session that monitors and autofixes the current PR"
      onCancel={handleCancel}
      hideInputGuide
    >
      <Box flexDirection="column" gap={1} marginBottom={1}>
        {error ? (
          <>
            <Text color="error">{error}</Text>
            <Text dimColor>Press Esc to close</Text>
          </>
        ) : (
          <>
            <LoadingState message={PHASE_MESSAGE[phase]} />
            {pr && <Text dimColor>PR: {pr.url}</Text>}
            <Text dimColor>Esc to cancel</Text>
          </>
        )}
      </Box>
    </Dialog>
  )
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  return React.createElement(AutofixPrDialog, { onDone, context, prompt: args.trim() })
}
