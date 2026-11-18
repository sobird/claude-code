/**
 * TungstenLiveMonitor — footer pill for the active Tmux session.
 *
 * Rendered by REPL.tsx for ants whenever an instance is running. It is a
 * `.ts` module (not `.tsx`), so it builds its tree with `createElement` rather
 * than JSX. Reads only the reactive AppState fields the Tmux tool writes:
 * which session is active, what was last sent, and whether the panel is open.
 * Returns null when there is nothing to show so the footer stays quiet.
 */

import { createElement, type ReactNode } from 'react'

import { Box, Text } from '../../ink.js'
import { useAppState } from '../../state/AppState.js'

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function TungstenLiveMonitor(): ReactNode {
  const active = useAppState((s) => s.tungstenActiveSession)
  const lastCommand = useAppState((s) => s.tungstenLastCommand)
  const capturedAt = useAppState((s) => s.tungstenLastCapturedTime)
  const panelVisible = useAppState((s) => s.tungstenPanelVisible)

  if (!active && !panelVisible) return null

  const parts: string[] = ['tmux']
  if (active) parts.push(active.sessionName)
  if (lastCommand) parts.push(`› ${lastCommand.command} (${formatClock(lastCommand.timestamp)})`)
  if (capturedAt) parts.push(`captured ${formatClock(capturedAt)}`)
  if (panelVisible && !active) parts.push('panel open')

  return createElement(Box, { paddingLeft: 1 }, createElement(Text, { dimColor: true }, parts.join(' · ')))
}
