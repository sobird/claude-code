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
import { cx } from '../../lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

import styles from './permission-mode-menu.module.css'

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
          className={cx(styles.trigger, className)}
        >
          <span className={styles.label}>{currentLabel}</span>
          <ChevronDown className={styles.icon} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={styles.menu}>
        <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {WEB_PERMISSION_MODES.map((option) => (
          <DropdownMenuItem
            key={option}
            data-testid={`permission-mode-${option}`}
            disabled={pending}
            onSelect={() => onSelect(option)}
          >
            <span className={styles.optionLabel}>{t.has(option) ? t(option) : option}</span>
            {option === mode ? <Check className={styles.check} aria-hidden="true" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
