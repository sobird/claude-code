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

import type { ModelOption } from '../../lib/model-settings'
import { cn } from '../../lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

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
      <DropdownMenuTrigger asChild disabled={disabled || pending}>
        <button
          type="button"
          data-testid="model-menu-trigger"
          aria-label={t('label')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-1 px-2.5 py-1 font-mono text-xs text-text-secondary transition-colors hover:border-brand/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60',
            className,
          )}
        >
          <span className="max-w-[10rem] truncate">{currentLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {listState === 'loading' ? <div className="px-2 py-1.5 text-xs text-text-muted">{t('loading')}</div> : null}
        {listed.map((option) => (
          <DropdownMenuItem
            key={option.value}
            data-testid={`model-option-${option.value}`}
            disabled={pending}
            onSelect={() => onSelect(option.value)}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{option.displayName}</span>
              {option.description ? (
                <span className="truncate text-xs text-text-muted">{option.description}</span>
              ) : null}
            </span>
            {option.value === model ? <Check className="h-4 w-4 text-brand" aria-hidden="true" /> : null}
          </DropdownMenuItem>
        ))}
        {listState === 'ready' && listed.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-text-muted">{t('empty')}</div>
        ) : null}
        <DropdownMenuItem data-testid="model-default" disabled={pending} onSelect={() => onSelect(null)}>
          <span className="flex-1">{t('default')}</span>
          {model === null ? <Check className="h-4 w-4 text-brand" aria-hidden="true" /> : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="model-custom"
          disabled={pending}
          onSelect={(event) => {
            event.preventDefault()
            setCustomOpen(true)
            requestAnimationFrame(() => inputRef.current?.focus())
          }}
        >
          {t('custom')}
        </DropdownMenuItem>
        {customOpen ? (
          <div className="flex items-center gap-1.5 px-2 py-1.5">
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
              className="min-w-0 flex-1 rounded-md border border-border bg-surface-1 px-2 py-1 font-mono text-xs text-text-primary outline-none focus:border-brand/50"
            />
            <button
              type="button"
              data-testid="model-custom-apply"
              onClick={applyCustom}
              className="rounded-md border border-border px-2 py-1 text-xs text-text-secondary transition-colors hover:border-brand/40 hover:text-text-primary"
            >
              {t('apply')}
            </button>
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
