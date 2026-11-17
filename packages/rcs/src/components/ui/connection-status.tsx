'use client'

import { useTranslations } from 'next-intl'

import { cn } from '../../lib/utils'

/** Connection state shown by the navbar badge. */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

const connectionDotStyles: Record<ConnectionState, string> = {
  disconnected: 'bg-text-muted',
  connecting: 'bg-status-warning animate-pulse',
  connected: 'bg-status-active',
  error: 'bg-status-error',
}

/** Small dot indicator for connection state. */
export function StatusDot({ state, className }: { state: ConnectionState; className?: string }) {
  return <span className={cn('h-2 w-2 rounded-full', connectionDotStyles[state], className)} aria-hidden="true" />
}

/** Dot plus label, used in the navbar badge. */
export function StatusIndicator({ state, className }: { state: ConnectionState; className?: string }) {
  const t = useTranslations('common.connection')
  return (
    <span className={cn('flex items-center gap-1.5 text-xs font-medium text-text-secondary', className)}>
      <StatusDot state={state} />
      {t(state)}
    </span>
  )
}

export function ConnectionStatusBar({
  state,
  displayUrl,
  className,
}: {
  state: ConnectionState
  displayUrl?: string
  className?: string
}) {
  const t = useTranslations('common.connection')
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <StatusDot state={state} />
      <span className="text-sm font-medium">{t(state)}</span>
      {state === 'connected' && displayUrl ? (
        <span className="max-w-[150px] truncate text-xs text-muted-foreground">{displayUrl}</span>
      ) : null}
    </div>
  )
}
