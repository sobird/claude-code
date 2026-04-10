import React, { useState } from 'react'
import { Box, Text, Link } from '../ink.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'
import { CCR_TERMS_URL } from 'src/commands/ultraplan.jsx'
import { getGlobalConfig, saveGlobalConfig } from 'src/utils/config.js'
import { useAppState, useSetAppState } from 'src/state/AppState.jsx'
import { useRegisterOverlay } from 'src/context/overlayContext.js'
import { getPromptIdentifier, getDialogConfig, type PromptIdentifier } from 'src/utils/ultraplan/prompt.js'

type ChoiceValue = 'run' | 'cancel'

interface Props {
  readonly onChoice: (
    choice: ChoiceValue,
    meta?: {
      disconnectedBridge: boolean
      promptIdentifier: PromptIdentifier
    },
  ) => void
}

function dispatchShowTermsLink(){
  return !getGlobalConfig().hasSeenUltraplanTerms
}

function dispatchPromptIdentifier() {
  return getPromptIdentifier()
}

export function UltraplanLaunchDialog({ onChoice }: Props): React.ReactNode {
  useRegisterOverlay('ultraplan-launch')

  const [showTermsLink, setHasSeenTerms] = useState(dispatchShowTermsLink)
  // Stable prompt identifier for this dialog instance
  const [promptIdentifier] = React.useState(dispatchPromptIdentifier)

  // Dialog copy derived from the prompt identifier
  const dialogConfig = React.useMemo(() => {
    return getDialogConfig(promptIdentifier)
  }, [promptIdentifier])

  // Whether the remote-control bridge is currently active
  const isBridgeEnabled = useAppState(state => state.replBridgeEnabled)

  const setAppState = useSetAppState()

  const handleChoice = React.useCallback((value: ChoiceValue) => {
      // If the user chose "run" while the bridge is enabled, disconnect it
      // first so the ultraplan session doesn't collide with remote control.
      const disconnectedBridge = value === 'run' && isBridgeEnabled

      if (disconnectedBridge) {
        setAppState((prev) => {
          if (!prev.replBridgeEnabled) {
            return prev
          }
          return {
            ...prev,
            replBridgeEnabled: false,
            replBridgeExplicit: false,
            replBridgeOutboundOnly: false,
          }
        })
      }

      // Persist that the user has now seen the ultraplan terms
      if (value !== 'cancel' && showTermsLink) {
        saveGlobalConfig(prev => (prev.hasSeenUltraplanTerms ? prev : { ...prev, hasSeenUltraplanTerms: true }))
      }

      onChoice(value, { disconnectedBridge, promptIdentifier})
    },
    [onChoice, isBridgeEnabled, setAppState, showTermsLink],
  )

  const handleCancel = React.useCallback(() => {
    handleChoice('cancel')
  }, [handleChoice])

  const runDescription = isBridgeEnabled
    ? 'Disable remote control and launch in Claude Code on the web'
    : 'launch in Claude Code on the web'

  const options = [
    {
      label: 'Run ultraplan',
      value: 'run' as const,
      description: runDescription,
    },
    { label: 'Not now', value: 'cancel' as const },
  ]

  return (
    <Dialog
      title="Run ultraplan in the cloud?"
      subtitle={dialogConfig.timeEstimate}
      onCancel={handleCancel}
    >
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text dimColor>{dialogConfig.dialogBody}</Text>
          {
            showTermsLink
              ? (
                  <Text dimColor>
                  For more information on Claude Code on the web:
                  <Link url={CCR_TERMS_URL}>{CCR_TERMS_URL}</Link>
                  </Text>
                )
              : null
          }
        </Box>

        {/* Pipeline description (hidden when bridge will be disconnected) */}
        <Text dimColor>
          {isBridgeEnabled ? 'This will disable Remote Control for this session.' : dialogConfig.dialogPipeline}
        </Text>

        <Select
          options={options}
          onChange={handleChoice}
        />
      </Box>
    </Dialog>
  )
}
