/**
 * WebBrowserPanel — the visible surface of the WebBrowser tool ("bagel").
 *
 * A `.ts` module, so it builds elements with `createElement` instead of JSX.
 * REPL.tsx renders it under feature('WEB_BROWSER_TOOL'); it reads the same
 * AppState fields WebBrowserTool writes and returns null while the panel is
 * closed, keeping the footer/overlay invisible until a page is opened.
 *
 * Approximation: no native WebView is hosted in this tree, so the panel shows
 * the address and a status line rather than rendered page content.
 */

import { createElement, type ReactNode } from 'react'

import { Box, Text } from '../../ink.js'
import { useAppState } from '../../state/AppState.js'

export function WebBrowserPanel(): ReactNode {
  const active = useAppState((s) => s.bagelActive)
  const url = useAppState((s) => s.bagelUrl)
  const visible = useAppState((s) => s.bagelPanelVisible)

  if (!active || !visible) return null

  return createElement(
    Box,
    { flexDirection: 'column', borderStyle: 'round', paddingX: 1 },
    createElement(Text, { bold: true }, 'Browser'),
    createElement(Text, { dimColor: true }, url ?? '(no page)'),
  )
}
