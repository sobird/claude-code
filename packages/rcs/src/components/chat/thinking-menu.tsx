'use client'

/**
 * Header control for extended thinking.
 *
 * `system/init` carries no thinking state, so the trigger can only show the
 * web's last confirmed choice (or Default, which is what the CLI starts with).
 * Selecting sends `set_max_thinking_tokens`; the label moves when the CLI's
 * control_response lands, matching the model and permission-mode menus.
 */

import { Brain, Check, ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { ThinkingChoice, ThinkingState } from '../../lib/thinking'
import { cx } from '../../lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

import styles from './thinking-menu.module.css'

interface ThinkingMenuProps {
  /** Last confirmed web request; `null` renders the default label. */
  value: ThinkingState
  /** A switch is in flight; the trigger stays disabled until the CLI answers. */
  pending?: boolean
  disabled?: boolean
  onSelect: (choice: ThinkingChoice) => void
  className?: string
}

const CHOICES: ThinkingChoice[] = ['default', 'on', 'off']

export function ThinkingMenu({ value, pending = false, disabled = false, onSelect, className }: ThinkingMenuProps) {
  const t = useTranslations('session.view.thinking')
  const currentLabel = value === null ? t('default') : t(value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled || pending}>
        <button
          type="button"
          data-testid="thinking-menu-trigger"
          aria-label={t('label')}
          className={cx(styles.trigger, className)}
        >
          <Brain className={styles.icon} aria-hidden="true" />
          <span className={styles.label}>{currentLabel}</span>
          <ChevronDown className={styles.icon} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={styles.menu}>
        <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {CHOICES.map((choice) => {
          const selected = choice === 'default' ? value === null : value === choice
          return (
            <DropdownMenuItem
              key={choice}
              data-testid={`thinking-option-${choice}`}
              disabled={pending}
              onSelect={() => onSelect(choice)}
            >
              <span className={styles.optionLabel}>{t(choice)}</span>
              {selected ? <Check className={styles.check} aria-hidden="true" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
