'use client'

/**
 * Header control for the CLI's model.
 *
 * The current model comes from `system/init`; the list is fetched lazily from
 * the gateway's `/models` endpoint, which proxies a one-shot `initialize` to the
 * CLI. Some bridge modes report no models, so the menu always offers a free-text
 * fallback. Selection is not applied optimistically — the header moves only when
 * the CLI's control_response lands, matching the permission-mode menu.
 */

import { Check, ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import type { ModelOption } from '@/lib/model-settings'
import { cx } from '@/lib/utils'

import styles from './ModelMenu.module.css'

interface ModelMenuProps {
  /** Current model id from `system/init`; `null` renders the default label. */
  model: string | null
  /** A switch is in flight; the trigger stays disabled until the CLI answers. */
  pending?: boolean
  disabled?: boolean
  onSelect: (model: string | null) => void
  /** Fetch the CLI's model list; called once, lazily, when the menu opens. */
  loadModels: () => Promise<ModelOption[]>
  className?: string
}

type ListState = 'idle' | 'loading' | 'ready'

export function ModelMenu({
  model,
  pending = false,
  disabled = false,
  onSelect,
  loadModels,
  className,
}: ModelMenuProps) {
  const t = useTranslations('session.view.model')
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<ModelOption[]>([])
  const [listState, setListState] = useState<ListState>('idle')
  const [customOpen, setCustomOpen] = useState(false)
  const [customValue, setCustomValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const ensureLoaded = () => {
    if (listState !== 'idle') return
    setListState('loading')
    void loadModels()
      .then((models) => {
        setOptions(models)
        setListState('ready')
      })
      .catch(() => {
        setOptions([])
        setListState('ready')
      })
  }

  const applyCustom = () => {
    const value = customValue.trim()
    onSelect(value.length > 0 ? value : null)
    // Submitting a model closes the whole menu: the inline editor lives inside
    // the dropdown content, so hiding only the editor would leave a stale menu.
    setOpen(false)
    setCustomOpen(false)
    setCustomValue('')
  }

  const currentLabel = model ? (options.find((option) => option.value === model)?.displayName ?? model) : t('default')
  // The CLI's own default entry (value `default`) duplicates our fixed row.
  const listed = options.filter((option) => option.value !== 'default')

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          ensureLoaded()
        } else {
          setCustomOpen(false)
          setCustomValue('')
        }
      }}
    >
      <DropdownMenuTrigger
        disabled={disabled || pending}
        render={
          <button
            type="button"
            data-testid="model-menu-trigger"
            aria-label={t('label')}
            className={cx(styles.trigger, className)}
          />
        }
      >
        <span className={styles.label}>{currentLabel}</span>
        <ChevronDown className={styles.icon} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={styles.menu}>
        <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {listState === 'loading' ? <div className={styles.state}>{t('loading')}</div> : null}
        {listed.map((option) => (
          <DropdownMenuItem
            key={option.value}
            data-testid={`model-option-${option.value}`}
            disabled={pending}
            onClick={() => onSelect(option.value)}
          >
            <span className={styles.optionBody}>
              <span className={styles.optionName}>{option.displayName}</span>
              {option.description ? <span className={styles.optionDescription}>{option.description}</span> : null}
            </span>
            {option.value === model ? <Check className={styles.check} aria-hidden="true" /> : null}
          </DropdownMenuItem>
        ))}
        {listState === 'ready' && listed.length === 0 ? <div className={styles.state}>{t('empty')}</div> : null}
        <DropdownMenuItem data-testid="model-default" disabled={pending} onClick={() => onSelect(null)}>
          <span className={styles.optionLabel}>{t('default')}</span>
          {model === null ? <Check className={styles.check} aria-hidden="true" /> : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="model-custom"
          disabled={pending}
          closeOnClick={false}
          onClick={() => {
            setCustomOpen(true)
            requestAnimationFrame(() => inputRef.current?.focus())
          }}
        >
          {t('custom')}
        </DropdownMenuItem>
        {customOpen ? (
          <div className={styles.customRow}>
            <input
              ref={inputRef}
              data-testid="model-custom-input"
              value={customValue}
              onChange={(event) => setCustomValue(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Enter') {
                  event.preventDefault()
                  applyCustom()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  setCustomOpen(false)
                  setCustomValue('')
                }
              }}
              placeholder={t('customPlaceholder')}
              className={styles.customInput}
            />
            <button type="button" data-testid="model-custom-apply" onClick={applyCustom} className={styles.apply}>
              {t('apply')}
            </button>
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
