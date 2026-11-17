'use client'

/**
 * Pending permission cards, pinned above the chat input. Buttons are
 * thumb-friendly on mobile (full-width, 44px targets) and compact on desktop.
 */

import { Check, ShieldAlert, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'

import { isAskUserQuestionRequest } from '../../lib/ask-user-question'
import { resolvePermissionKey } from '../../lib/permission-keys'
import type { PendingPermission } from '../../lib/session-reducer'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { AskUserQuestionCard } from './ask-user-question-card'

interface PermissionPanelProps {
  requests: PendingPermission[]
  onRespond?: (requestId: string, approved: boolean, updatedInput?: Record<string, unknown>) => void
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
          if (request) onRespond?.(request.requestId, action.action === 'allow')
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
  onRespond?: (requestId: string, approved: boolean, updatedInput?: Record<string, unknown>) => void
}) {
  const t = useTranslations('chat')
  const inputPreview = formatInput(request.toolInput)

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
          {inputPreview ? (
            <pre className="mt-1.5 max-h-28 overflow-x-auto rounded-md bg-surface-2/70 p-2 font-mono text-[11px] text-text-secondary">
              {inputPreview}
            </pre>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          variant="brand"
          aria-keyshortcuts="a"
          className="h-11 flex-1 sm:h-9 sm:flex-none sm:px-4"
          onClick={() => onRespond?.(request.requestId, true)}
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
          onClick={() => onRespond?.(request.requestId, false)}
        >
          <X className="h-4 w-4" />
          {t('deny')}
          <ShortcutHint label="D" />
        </Button>
      </div>
    </div>
  )
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
