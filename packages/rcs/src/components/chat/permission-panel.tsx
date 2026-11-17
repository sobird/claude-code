'use client'

/**
 * Pending permission cards, pinned above the chat input. Buttons are
 * thumb-friendly on mobile (full-width, 44px targets) and compact on desktop.
 */

import { Check, ShieldAlert, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { PendingPermission } from '../../lib/session-reducer'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'

interface PermissionPanelProps {
  requests: PendingPermission[]
  onRespond?: (requestId: string, approved: boolean) => void
  className?: string
}

export function PermissionPanel({ requests, onRespond, className }: PermissionPanelProps) {
  if (requests.length === 0) return null

  return (
    <div className={cn('mx-auto w-full max-w-3xl px-1 sm:px-0', className)}>
      <div className="space-y-2">
        {requests.map((request) => (
          <PermissionCard key={request.requestId} request={request} onRespond={onRespond} />
        ))}
      </div>
    </div>
  )
}

function PermissionCard({
  request,
  onRespond,
}: {
  request: PendingPermission
  onRespond?: (requestId: string, approved: boolean) => void
}) {
  const t = useTranslations('chat')
  const inputPreview = formatInput(request.toolInput)

  return (
    <div className="rounded-xl border border-warning-border/30 bg-warning-bg/60 px-3 py-3 sm:px-4">
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
          className="h-11 flex-1 sm:h-9 sm:flex-none sm:px-4"
          onClick={() => onRespond?.(request.requestId, true)}
        >
          <Check className="h-4 w-4" />
          {t('allow')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 flex-1 border-warning-border/40 text-warning-text hover:bg-warning-bg sm:h-9 sm:flex-none sm:px-4"
          onClick={() => onRespond?.(request.requestId, false)}
        >
          <X className="h-4 w-4" />
          {t('deny')}
        </Button>
      </div>
    </div>
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
