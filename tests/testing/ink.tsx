/*
 * Utilities for testing Ink apps
 *
 * @see https://github.com/vadimdemedes/ink-testing-library/blob/master/source/index.ts
 *
 * sobird<i@sobird.me> at 2026/04/21 4:06:25 created.
 */

import { ConsoleOAuthFlow } from 'src/components/ConsoleOAuthFlow.tsx'
import { UltraplanChoiceDialog } from 'src/components/UltraplanChoiceDialog.js'
import { render } from 'src/ink.js'
import { KeybindingSetup } from 'src/keybindings/KeybindingProviderSetup.tsx'
import { AppStateProvider } from 'src/state/AppState.tsx'
import { enableConfigs } from 'src/utils/config.ts'

enableConfigs()

const test = await render(
  <AppStateProvider>
    <KeybindingSetup>
      <ConsoleOAuthFlow />
    </KeybindingSetup>
  </AppStateProvider>,
  {},
)
