/**
 * WorkflowPermissionRequest — confirmation UI for running a workflow.
 *
 * `permissionComponentForTool` selects this when the pending tool is
 * WorkflowTool. Only `run` asks; list/describe are read-only and the tool
 * auto-allows them in `checkPermissions`, so this component normally only sees
 * `run`. It adds a workflow-specific header (name and arguments) above the
 * standard allow/deny prompt rather than reimplementing the dialog.
 *
 * This is a `.ts` module (so it uses `createElement`) and imports
 * FallbackPermissionRequest, not PermissionRequest itself — the type-only
 * import of PermissionRequestProps is erased, so the require() in
 * PermissionRequest.tsx does not create a runtime cycle.
 */

import { createElement, type ReactNode } from 'react'

import { FallbackPermissionRequest } from '../../components/permissions/FallbackPermissionRequest.js'
import type { PermissionRequestProps } from '../../components/permissions/PermissionRequest.js'
import { Box, Text } from '../../ink.js'

export function WorkflowPermissionRequest(props: PermissionRequestProps): ReactNode {
  const input = props.toolUseConfirm.input as { action?: string; name?: string; args?: string[] }
  if (input.action !== 'run') {
    return createElement(FallbackPermissionRequest, props)
  }
  return createElement(
    Box,
    { flexDirection: 'column' },
    createElement(Text, { bold: true }, `Run workflow ${input.name ?? '(unnamed)'}`),
    input.args && input.args.length > 0
      ? createElement(Text, { dimColor: true }, `args: ${input.args.join(' ')}`)
      : null,
    createElement(FallbackPermissionRequest, props),
  )
}
