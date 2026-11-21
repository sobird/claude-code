/**
 * Shared labels for permission-suggestion buttons. Both the generic permission
 * card and the ExitPlanMode card render the CLI's `permission_suggestions`, so
 * the wording lives in one place.
 */

import type { useTranslations } from 'next-intl'

import type { PermissionOption } from '@/lib/permission-suggestions'

export type ChatTranslator = ReturnType<typeof useTranslations<'chat'>>

export function optionLabel(option: PermissionOption, t: ChatTranslator): string {
  switch (option.kind) {
    case 'allow-once':
      return t('allow')
    case 'allow-session':
      return t('permission.allowSession')
    case 'allow-always':
      return t('permission.allowAlways')
    case 'accept-edits':
      return t('permission.acceptEdits')
    case 'allow-directories':
      return t('permission.allowDirectories')
    case 'always-deny':
      return t('permission.alwaysDeny')
    case 'apply-suggestion':
      return t('permission.applySuggestion')
  }
}

export function optionDetail(option: PermissionOption): string {
  if (option.rules?.length) {
    return option.rules
      .map((rule) => (rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName))
      .join(', ')
  }
  if (option.directories?.length) return option.directories.join(', ')
  return option.mode ?? ''
}
