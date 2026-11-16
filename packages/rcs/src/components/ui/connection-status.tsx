import { cn } from '../../lib/utils'

/** Connection state shown by the navbar badge. */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

const connectionDotStyles: Record<ConnectionState, string> = {
  disconnected: 'bg-text-muted',
  connecting: 'bg-status-warning animate-pulse',
  connected: 'bg-status-active',
  error: 'bg-status-error',
}

const connectionStateLabels: Record<ConnectionState, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting...',
  connected: 'Connected',
  error: 'Connection error',
}

export function getConnectionStateLabel(state: ConnectionState): string {
  return connectionStateLabels[state]
}

/** Small dot indicator for connection state. */
export function StatusDot({ state, className }: { state: ConnectionState; className?: string }) {
  return <span className={cn('h-2 w-2 rounded-full', connectionDotStyles[state], className)} aria-hidden="true" />
}

/** Dot plus label, used in the navbar badge. */
export function StatusIndicator({ state, className }: { state: ConnectionState; className?: string }) {
  return (
    <span className={cn('flex items-center gap-1.5 text-xs font-medium text-text-secondary', className)}>
      <StatusDot state={state} />
      {getConnectionStateLabel(state)}
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
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <StatusDot state={state} />
      <span className="text-sm font-medium">{getConnectionStateLabel(state)}</span>
      {state === 'connected' && displayUrl ? (
        <span className="max-w-[150px] truncate text-xs text-muted-foreground">{displayUrl}</span>
      ) : null}
    </div>
  )
}
