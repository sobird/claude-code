import { Dialog } from 'src/components/design-system/Dialog.js'

import { Box, Text } from '../ink.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { getAntModelOverrideConfig } from '../utils/model/antModels.js'
import { Select } from './CustomSelect/index.js'

interface Props {
  onDone: (selection: string, modelAlias?: string) => void
}

/** Don't nag more than once per day for an already-surfaced version. */
const RESHOW_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * Ant-only one-time prompt announcing a new internal model. The copy and
 * target alias come from the `tengu_ant_model_override` GrowthBook config so a
 * model launch needs no code change.
 */
export const AntModelSwitchCallout = ({ onDone }: Props): React.ReactNode => {
  const callout = getAntModelOverrideConfig()?.switchCallout
  if (!callout) return null

  const handleSelect = (value: string): void => {
    if (value === 'switch') {
      onDone('switch', callout.modelAlias)
      return
    }
    if (value === 'never') {
      saveGlobalConfig((current) => ({
        ...current,
        modelSwitchCalloutDismissed: true,
        modelSwitchCalloutVersion: callout.version,
      }))
    }
    onDone(value)
  }

  return (
    <Dialog
      title={`New model: ${callout.version}`}
      subtitle={callout.description}
      onCancel={() => onDone('later')}
      hideInputGuide
    >
      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor>You can switch back at any time with /model.</Text>
      </Box>
      <Select
        options={[
          ...(callout.modelAlias ? [{ value: 'switch', label: `Switch to ${callout.version}` }] : []),
          { value: 'later', label: 'Maybe later' },
          { value: 'never', label: "Don't show again" },
        ]}
        onChange={handleSelect}
      />
    </Dialog>
  )
}

/**
 * Whether to surface the model-switch callout. True only for internal users
 * with a live `switchCallout` config that hasn't been permanently dismissed or
 * shown within the last day. Records the show so a restart won't prompt again
 * until the interval elapses.
 */
export function shouldShowModelSwitchCallout(): boolean {
  if (process.env.USER_TYPE !== 'ant') return false
  const callout = getAntModelOverrideConfig()?.switchCallout
  if (!callout) return false

  const config = getGlobalConfig()
  if (config.modelSwitchCalloutDismissed) return false
  if (Date.now() - (config.modelSwitchCalloutLastShown ?? 0) < RESHOW_INTERVAL_MS) return false

  // Record only the show time — "Maybe later" should resurface this version
  // after the interval, while "Don't show again" sets the permanent flags.
  saveGlobalConfig((current) => ({
    ...current,
    modelSwitchCalloutLastShown: Date.now(),
  }))
  return true
}
