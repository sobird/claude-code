'use client'

/**
 * Keyboard shortcut reference. Opened from the session header or the `?` key;
 * the list mirrors the shortcuts the chat surface actually implements.
 */

import { useTranslations } from 'next-intl'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'

const SECTIONS = [
  {
    title: 'composer',
    items: [
      { keys: 'Enter', label: 'send' },
      { keys: 'Shift+Enter', label: 'newline' },
      { keys: 'Esc', label: 'interrupt' },
      { keys: '↑ / ↓', label: 'history' },
      { keys: 'Ctrl+R', label: 'searchHistory' },
      { keys: 'Shift+Tab', label: 'cycleMode' },
      { keys: '/', label: 'commands' },
      { keys: 'Tab / Enter', label: 'accept' },
    ],
  },
  {
    title: 'approvals',
    items: [
      { keys: 'A', label: 'approve' },
      { keys: 'D', label: 'reject' },
      { keys: 'Enter', label: 'approveEnter' },
      { keys: 'Esc', label: 'close' },
    ],
  },
] as const

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('chat.shortcuts')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="shortcuts-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h3 className="mb-1.5 font-display text-xs font-semibold tracking-wide text-text-muted uppercase">
                {t(section.title)}
              </h3>
              <ul className="space-y-1">
                {section.items.map((item) => (
                  <li
                    key={`${section.title}-${item.label}`}
                    className="flex items-center justify-between gap-4 text-sm text-text-secondary"
                  >
                    <span>{t(item.label)}</span>
                    <kbd className="flex-shrink-0 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-text-primary">
                      {item.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
