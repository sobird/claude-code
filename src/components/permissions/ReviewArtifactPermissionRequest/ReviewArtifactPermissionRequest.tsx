import React, { useMemo } from 'react'

import { Box, Text } from '../../../ink.js'
import { truncateToLines } from '../../../utils/stringUtils.js'
import { type OptionWithDescription, Select } from '../../CustomSelect/select.js'
import { type UnaryEvent, usePermissionRequestLogging } from '../hooks.js'
import { PermissionDialog } from '../PermissionDialog.js'
import type { PermissionRequestProps } from '../PermissionRequest.js'
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js'
import { logUnaryPermissionEvent } from '../utils.js'

// The artifact body can be arbitrarily long (a whole plan or diff). The
// transcript already records the reviewed text, so the dialog only needs a
// preview long enough to judge — the full content is in the tool result.
const PREVIEW_LINES = 30

export function ReviewArtifactPermissionRequest({
  toolUseConfirm,
  onDone,
  onReject,
  workerBadge,
}: PermissionRequestProps): React.ReactNode {
  const input = toolUseConfirm.input as { title: string; content: string; kind?: string }

  const unaryEvent = useMemo<UnaryEvent>(() => ({ completion_type: 'tool_use_single', language_name: 'none' }), [])

  usePermissionRequestLogging(toolUseConfirm, unaryEvent)

  const options = useMemo((): OptionWithDescription[] => {
    return [
      { label: 'Yes', value: 'yes' },
      {
        label: (
          <Text>
            No, and tell Claude what to do differently <Text bold>(esc)</Text>
          </Text>
        ),
        value: 'no',
      },
    ]
  }, [])

  function onChange(newValue: string) {
    switch (newValue) {
      case 'yes':
        logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept')
        toolUseConfirm.onAllow(toolUseConfirm.input, [])
        onDone()
        break
      case 'no':
        logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'reject')
        toolUseConfirm.onReject()
        onReject()
        onDone()
        break
    }
  }

  return (
    <PermissionDialog title="Review artifact" workerBadge={workerBadge}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text>
          <Text bold>{input.kind ?? 'document'}</Text>: {input.title}
        </Text>
        <Text dimColor>{toolUseConfirm.description}</Text>
      </Box>

      <Box flexDirection="column" paddingX={2}>
        <Text wrap="wrap">{truncateToLines(input.content, PREVIEW_LINES)}</Text>
      </Box>

      <Box flexDirection="column">
        <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="tool" />
        <Text>Do you approve this artifact?</Text>
        <Select options={options} onChange={onChange} onCancel={() => onChange('no')} />
      </Box>
    </PermissionDialog>
  )
}
