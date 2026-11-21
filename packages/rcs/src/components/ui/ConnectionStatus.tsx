'use client'

import { useTranslations } from 'next-intl'

import { cx } from '@/lib/utils'

import styles from './ConnectionStatus.module.css'

/** Connection state shown by the navbar badge. */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

const connectionDotStyles: Record<ConnectionState, string> = {
  disconnected: styles.disconnected,
  connecting: styles.connecting,
  connected: styles.connected,
  error: styles.error,
}

/** Small dot indicator for connection state. */
export function StatusDot({ state, className }: { state: ConnectionState; className?: string }) {
  return <span className={cx(styles.dot, connectionDotStyles[state], className)} aria-hidden="true" />
}

/** Dot plus label, used in the navbar badge. */
export function StatusIndicator({ state, className }: { state: ConnectionState; className?: string }) {
  const t = useTranslations('common.connection')
  return (
    <span className={cx(styles.indicator, className)}>
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
    <div className={cx(styles.bar, className)}>
      <StatusDot state={state} />
      <span className={styles.barLabel}>{t(state)}</span>
      {state === 'connected' && displayUrl ? <span className={styles.barUrl}>{displayUrl}</span> : null}
    </div>
  )
}
