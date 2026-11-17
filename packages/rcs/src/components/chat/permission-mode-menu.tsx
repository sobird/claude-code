'use client'

/**
 * Header control for the CLI's permission mode.
 *
 * Hidden until `system/init` reports a mode, because the web cannot know the
 * current mode otherwise. Selecting a mode sends `set_permission_mode` and the
 * display updates from the CLI's control_response — never optimistically, since
 * the CLI may reject it by policy (e.g. bypass without the CLI flag).
 */

import { Check, ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { WEB_PERMISSION_MODES, type WebPermissionMode } from '../../lib/permission-modes'
import { cn } from '../../lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

interface PermissionModeMenuProps {
  /** `null` until `system/init` arrives; hides the control entirely. */
  mode: string | null
  /** A switch is in flight; the trigger stays disabled until the CLI answers. */
  pending?: boolean
  disabled?: boolean
  onSelect: (mode: WebPermissionMode) => void
  className?: string
}

export function PermissionModeMenu({
  mode,
  pending = false,
  disabled = false,
  onSelect,
  className,
}: PermissionModeMenuProps) {
  const t = useTranslations('session.view.mode')
  if (!mode) return null

  const currentLabel = t.has(mode) ? t(mode) : mode

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled || pending}>
        <button
          type="button"
          data-testid="permission-mode-trigger"
          aria-label={t('label')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-1 px-2.5 py-1 font-display text-xs text-text-secondary transition-colors hover:border-brand/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60',
            className,
          )}
        >
          <span className="truncate">{currentLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {WEB_PERMISSION_MODES.map((option) => (
          <DropdownMenuItem
            key={option}
            data-testid={`permission-mode-${option}`}
            disabled={pending}
            onSelect={() => onSelect(option)}
          >
            <span className="flex-1">{t.has(option) ? t(option) : option}</span>
            {option === mode ? <Check className="h-4 w-4 text-brand" aria-hidden="true" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
