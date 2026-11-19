import React, { useMemo } from 'react'

import { Box, Text } from '../../../ink.js'
import { MonitorTool } from '../../../tools/MonitorTool/MonitorTool.js'
import { type OptionWithDescription, Select } from '../../CustomSelect/select.js'
import { type UnaryEvent, usePermissionRequestLogging } from '../hooks.js'
import { PermissionDialog } from '../PermissionDialog.js'
import type { PermissionRequestProps } from '../PermissionRequest.js'
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js'
import { logUnaryPermissionEvent } from '../utils.js'

export function MonitorPermissionRequest({
  toolUseConfirm,
  onDone,
  onReject,
  workerBadge,
}: PermissionRequestProps): React.ReactNode {
  const input = toolUseConfirm.input as { server: string; duration_seconds?: number }

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
    <PermissionDialog title="Monitor" workerBadge={workerBadge}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text>{MonitorTool.renderToolUseMessage(input)}</Text>
        <Text dimColor>{toolUseConfirm.description}</Text>
      </Box>

      <Box flexDirection="column">
        <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="tool" />
        <Text>Do you want to allow Claude to watch this MCP server?</Text>
        <Select options={options} onChange={onChange} onCancel={() => onChange('no')} />
      </Box>
    </PermissionDialog>
  )
}
