/**
 * Live UI harness for the vendored Ink fork (`src/ink`).
 *
 *   bun run dev:ui          # = bun --watch scripts/ui-harness.tsx
 *
 * Renders a real screen into the terminal; save any imported file and the
 * watcher restarts the process, redrawing the screen. Ctrl+C quits.
 *
 * Why a process restart instead of true hot-swap: Ink drives a reconciler that
 * owns terminal state (raw mode, cursor, diff buffers). Swapping the React tree
 * mid-flight would desync that state, so full-screen TUI "live reload" is a
 * fresh render each time — `bun --watch` supplies the restart.
 *
 * Edit `Demo` below to preview a different screen. Real screens need the same
 * providers the app mounts, so this mirrors tests/testing/ink.tsx:
 * AppStateProvider + KeybindingSetup (and `src/ink.js`'s render adds
 * ThemeProvider on top).
 */
import React from 'react'
import { CostThresholdDialog } from 'src/components/CostThresholdDialog.js'
import { render, type Instance } from 'src/ink.js'
import { KeybindingSetup } from 'src/keybindings/KeybindingProviderSetup.tsx'
import { AppStateProvider } from 'src/state/AppState.tsx'
import { enableConfigs } from 'src/utils/config.ts'

enableConfigs()

// ---- edit this -------------------------------------------------------------
// Swap in any screen. Keep it side-effect-free so a stray Enter in the preview
// doesn't touch real state — e.g. AutoModeOptInDialog writes userSettings on
// accept. See each file for the props it needs.
function Demo(): React.ReactNode {
  return <CostThresholdDialog onDone={() => {}} />
}
// ---------------------------------------------------------------------------

const instance: Instance = await render(
  <AppStateProvider>
    <KeybindingSetup>
      <Demo />
    </KeybindingSetup>
  </AppStateProvider>,
)

// The watcher restarts us on file changes; unmount first so Ink restores raw
// mode / cursor before the next process takes over the terminal.
const shutdown = (): void => {
  try {
    instance.unmount()
  } catch {
    // Already unmounted.
  }
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
