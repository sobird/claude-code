'use client'

/**
 * Keyboard shortcut reference. Opened from the session header or the `?` key;
 * the list mirrors the shortcuts the chat surface actually implements.
 */

import { useTranslations } from 'next-intl'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/Dialog'

import styles from './ShortcutsDialog.module.css'

const SECTIONS = [
  {
    title: 'composer',
    items: [
      { keys: 'Enter', label: 'send' },
      { keys: 'Cmd/Ctrl+Enter', label: 'sendQueued' },
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
  {
    title: 'navigation',
    items: [
      { keys: 'Shift+↑', label: 'enterCursor' },
      { keys: '↑ / ↓ / j / k', label: 'history' },
      { keys: 'Enter', label: 'cursorEnter' },
      { keys: 'c', label: 'cursorCopy' },
      { keys: 'p', label: 'cursorPrimary' },
      { keys: 'Esc', label: 'cursorBack' },
    ],
  },
  {
    title: 'transcript',
    items: [{ keys: 'Ctrl+O', label: 'toggleVerbose' }],
  },
] as const

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('chat.shortcuts')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="shortcuts-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className={styles.body}>
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h3 className={styles.sectionTitle}>{t(section.title)}</h3>
              <ul className={styles.list}>
                {section.items.map((item) => (
                  <li key={`${section.title}-${item.label}`} className={styles.item}>
                    <span>{t(item.label)}</span>
                    <kbd className={styles.kbd}>{item.keys}</kbd>
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
