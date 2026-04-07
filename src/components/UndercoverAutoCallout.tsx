import { Box, Text } from '../ink.js'
import { saveGlobalConfig, getGlobalConfig} from '../utils/config.js'
import { Dialog } from 'src/components/design-system/Dialog.js'
import { Select } from './CustomSelect/index.js'


interface Props {
  onDone: () => void
}

export function UndercoverAutoCallout({ onDone }: Props): React.ReactNode {
  const handleConfirm = () => {
    onDone();

    saveGlobalConfig(current => ({
      ...current,
      hasSeenUndercoverAutoNotice: true,
    }))
  }
  return (
    <Dialog
      title="⚠️ Undercover Mode Activated"
      subtitle="Auto-detection indicates you're working in a public/open-source environment. All outputs will be sanitized to prevent internal information leaks."
      onCancel={handleConfirm}
      hideInputGuide>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Undercover Mode Requirements:</Text>
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          <Text dimColor>• Commit messages MUST NOT contain Anthropic internal information</Text>
          <Text dimColor>• No internal model codenames (Capybara, Tengu, etc.)</Text>
          <Text dimColor>• No unreleased version numbers or project names</Text>
          <Text dimColor>• No attribution lines or co-author mentions</Text>
          <Text dimColor>• Write as a human developer - describe only the code change</Text>
        </Box>
      </Box>

      <Box flexDirection="column">
        <Text dimColor>
          You can disable undercover mode for this session by setting CLAUDE_CODE_UNDERCOVER=0
        </Text>
        <Text color="error">
          Violating undercover mode requirements may result in immediate session termination.
        </Text>
      </Box>

      <Select
        options={[
          {
            value: 'ok',
            label: 'Got it, thanks!',
          },
        ]}
        onChange={handleConfirm}
      />
    </Dialog>
  )
}
