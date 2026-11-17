'use client'

/**
 * Pending permission cards, pinned above the chat input. Buttons are
 * thumb-friendly on mobile (full-width, 44px targets) and compact on desktop.
 *
 * Each card offers allow-once plus whatever the CLI suggested
 * (`permission_suggestions`): "allow for session", "always allow", directory
 * grants, auto-accept edits. Denying can attach a message the CLI passes back
 * to the model.
 */

import { Check, ShieldAlert, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'

import { isAskUserQuestionRequest } from '../../lib/ask-user-question'
import { resolvePermissionKey } from '../../lib/permission-keys'
import { permissionOptions, type PermissionDecision, type PermissionOption } from '../../lib/permission-suggestions'
import type { PendingPermission } from '../../lib/session-reducer'
import { diffLines, toolEditPreview } from '../../lib/text-diff'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { AskUserQuestionCard } from './ask-user-question-card'

type ChatTranslator = ReturnType<typeof useTranslations<'chat'>>

interface PermissionPanelProps {
  requests: PendingPermission[]
  onRespond?: (requestId: string, decision: PermissionDecision) => void
  className?: string
}

export function PermissionPanel({ requests, onRespond, className }: PermissionPanelProps) {
  const [selected, setSelected] = useState(0)
  // AskUserQuestion prompts are answered in their own card, so keyboard
  // approval shortcuts only navigate the plain allow/deny cards.
  const respondable = useMemo(
    () => requests.filter((request) => !isAskUserQuestionRequest(request.toolName, request.toolInput)),
    [requests],
  )
  // Clamp instead of syncing state so a shrinking request list never selects
  // an index that no longer exists.
  const activeIndex = Math.min(selected, Math.max(respondable.length - 1, 0))

  // Keyboard-only approvals: a document listener covers the case where focus is
  // still on the composer or elsewhere. Editable elements keep their keys.
  useEffect(() => {
    if (respondable.length === 0) return undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      const inEditable = Boolean(
        target?.closest('textarea, input, select, button, a[href], summary, [role="button"], [contenteditable="true"]'),
      )
      const action = resolvePermissionKey({
        key: event.key,
        requestCount: respondable.length,
        selectedIndex: activeIndex,
        inEditable,
        isComposing: event.isComposing,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      })
      if (action.action === 'ignore') return
      event.preventDefault()

      switch (action.action) {
        case 'allow':
        case 'deny': {
          const request = respondable[action.index]
          if (request) onRespond?.(request.requestId, { approved: action.action === 'allow' })
          return
        }
        case 'select':
          setSelected(action.index)
          return
        case 'next':
          setSelected(Math.min(activeIndex + 1, respondable.length - 1))
          return
        case 'previous':
          setSelected(Math.max(activeIndex - 1, 0))
          return
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [activeIndex, onRespond, respondable])

  if (requests.length === 0) return null

  const activeRequestId = respondable[activeIndex]?.requestId

  return (
    <div className={cn('mx-auto w-full max-w-3xl px-1 sm:px-0', className)}>
      <div className="space-y-2">
        {requests.map((request) =>
          isAskUserQuestionRequest(request.toolName, request.toolInput) ? (
            <AskUserQuestionCard key={request.requestId} request={request} onRespond={onRespond} />
          ) : (
            <PermissionCard
              key={request.requestId}
              request={request}
              selected={request.requestId === activeRequestId}
              onRespond={onRespond}
            />
          ),
        )}
      </div>
    </div>
  )
}

function PermissionCard({
  request,
  selected,
  onRespond,
}: {
  request: PendingPermission
  selected?: boolean
  onRespond?: (requestId: string, decision: PermissionDecision) => void
}) {
  const t = useTranslations('chat')
  const [denyOpen, setDenyOpen] = useState(false)
  const [feedback, setFeedback] = useState('')

  const options = useMemo(() => permissionOptions(request.suggestions), [request.suggestions])
  const allowOnce = options[0] ?? { id: 'allow-once', kind: 'allow-once' as const, suggestionIndex: null }
  // The CLI's deny result schema has no updatedPermissions, so a deny-rule
  // suggestion cannot be persisted from here; only allow-oriented ones show.
  const extraOptions = options.filter((option) => option.kind !== 'allow-once' && option.kind !== 'always-deny')
  const hunks = useMemo(() => toolEditPreview(request.toolInput), [request.toolInput])
  const inputPreview = formatInput(request.toolInput)

  const applyOption = (option: PermissionOption) => {
    const suggestion = option.suggestionIndex !== null ? request.suggestions[option.suggestionIndex] : undefined
    onRespond?.(request.requestId, {
      approved: true,
      ...(suggestion ? { updatedPermissions: [suggestion] } : {}),
    })
  }

  const submitDeny = () => {
    const message = feedback.trim()
    onRespond?.(request.requestId, { approved: false, ...(message ? { message } : {}) })
  }

  return (
    <div
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'rounded-xl border border-warning-border/30 bg-warning-bg/60 px-3 py-3 sm:px-4',
        selected && 'ring-2 ring-brand',
      )}
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning-text" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-medium text-warning-text">
            {request.toolName || t('toolFallback')}
          </div>
          {request.description ? (
            <div className="mt-0.5 text-xs text-warning-text/80">{request.description}</div>
          ) : null}
          {request.blockedPath ? (
            <div className="mt-0.5 font-mono text-[11px] text-warning-text/80">
              {t('permission.blockedPath', { path: request.blockedPath })}
            </div>
          ) : null}
          {hunks ? (
            <div className="mt-1.5 space-y-2">
              {hunks.map((hunk, index) => (
                <div key={index} className="overflow-hidden rounded-md border border-border/60 bg-surface-2/70">
                  {hunk.isNewFile ? (
                    <div className="border-b border-border/60 px-2 py-1 text-[10px] text-text-muted">+</div>
                  ) : null}
                  <pre className="max-h-56 overflow-auto px-0 py-1 font-mono text-[11px] leading-4">
                    {diffLines(hunk.before, hunk.after).map((line, lineIndex) => (
                      <div
                        key={lineIndex}
                        className={cn(
                          'px-2',
                          line.type === 'add' && 'bg-status-active/10 text-status-active',
                          line.type === 'remove' && 'bg-status-error/10 text-status-error',
                          line.type === 'context' && 'text-text-secondary',
                        )}
                      >
                        {line.type === 'add' ? '+ ' : line.type === 'remove' ? '- ' : '  '}
                        {line.text}
                      </div>
                    ))}
                  </pre>
                </div>
              ))}
            </div>
          ) : null}
          {inputPreview ? (
            <details className="mt-1.5" {...(hunks ? {} : { open: true })}>
              <summary className="cursor-pointer list-none font-display text-[11px] text-text-muted transition-colors hover:text-text-secondary">
                {t('toolRawInput')}
              </summary>
              <pre className="mt-1 max-h-28 overflow-x-auto rounded-md bg-surface-2/70 p-2 font-mono text-[11px] text-text-secondary">
                {inputPreview}
              </pre>
            </details>
          ) : null}
        </div>
      </div>

      {extraOptions.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {extraOptions.map((option) => {
            const detail = optionDetail(option)
            return (
              <Button
                key={option.id}
                type="button"
                variant="outline"
                className="h-9 gap-1.5 px-3 text-xs"
                onClick={() => applyOption(option)}
              >
                <span>{optionLabel(option, t)}</span>
                {detail ? <span className="font-mono text-[10px] text-text-muted">{detail}</span> : null}
              </Button>
            )
          })}
        </div>
      ) : null}

      {denyOpen ? (
        <div className="mt-2 space-y-1.5">
          <textarea
            className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            rows={2}
            placeholder={t('permission.denyPlaceholder')}
            aria-label={t('permission.denyReason')}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
          />
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-9 px-3" onClick={submitDeny}>
              <X className="h-4 w-4" />
              {t('permission.sendDeny')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-9 px-3"
              onClick={() => {
                setDenyOpen(false)
                setFeedback('')
              }}
            >
              {t('cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            variant="brand"
            aria-keyshortcuts="a"
            className="h-11 flex-1 sm:h-9 sm:flex-none sm:px-4"
            onClick={() => applyOption(allowOnce)}
          >
            <Check className="h-4 w-4" />
            {t('allow')}
            <ShortcutHint label="A" />
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-keyshortcuts="d"
            className="h-11 flex-1 border-warning-border/40 text-warning-text hover:bg-warning-bg sm:h-9 sm:flex-none sm:px-4"
            onClick={() => setDenyOpen(true)}
          >
            <X className="h-4 w-4" />
            {t('deny')}
            <ShortcutHint label="D" />
          </Button>
        </div>
      )}
    </div>
  )
}

function optionLabel(option: PermissionOption, t: ChatTranslator): string {
  switch (option.kind) {
    case 'allow-once':
      return t('allow')
    case 'allow-session':
      return t('permission.allowSession')
    case 'allow-always':
      return t('permission.allowAlways')
    case 'accept-edits':
      return t('permission.acceptEdits')
    case 'allow-directories':
      return t('permission.allowDirectories')
    case 'always-deny':
      return t('permission.alwaysDeny')
    case 'apply-suggestion':
      return t('permission.applySuggestion')
  }
}

function optionDetail(option: PermissionOption): string {
  if (option.rules?.length) {
    return option.rules
      .map((rule) => (rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName))
      .join(', ')
  }
  if (option.directories?.length) return option.directories.join(', ')
  return option.mode ?? ''
}

function ShortcutHint({ label }: { label: string }) {
  return (
    <kbd className="ml-1 hidden rounded border border-current/30 px-1 font-mono text-[10px] leading-4 opacity-70 sm:inline">
      {label}
    </kbd>
  )
}

function formatInput(input: Record<string, unknown>): string {
  if (!input || Object.keys(input).length === 0) return ''
  try {
    const json = JSON.stringify(input, null, 2)
    return json.length > 1200 ? `${json.slice(0, 1200)}...` : json
  } catch {
    return ''
  }
}
