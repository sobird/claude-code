'use client'

/**
 * 排队消息面板：展示 CLI 当前排队的用户消息，支持行内编辑、删除、插话。
 *
 * 队列的唯一真值在 CLI：这里只发出操作（返回的 Promise 可 reject），
 * 行状态由随后的 `queue_snapshot` 推送更新，组件自己不持有队列。
 */

import { CornerUpRight, Pencil, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { useApiErrorMessage } from '@/hooks/useApiErrorMessage'
import type { QueuedMessage, QueuePriority } from '@/lib/queue'
import { cx } from '@/lib/utils'

import styles from './QueueDock.module.css'

const PRIORITY_LABELS = {
  now: 'priorityNow',
  next: 'priorityNext',
  later: 'priorityLater',
} as const satisfies Record<QueuePriority, string>

export interface QueueDockProps {
  items: QueuedMessage[]
  /** 只有一轮进行中时插话才有意义；空闲时隐藏插话按钮。 */
  canSteer: boolean
  onEdit: (uuid: string, content: string) => Promise<void>
  onRemove: (uuid: string) => Promise<void>
  onSteer: (uuid: string) => Promise<void>
  onSteerAll: () => Promise<void>
  className?: string
}

export function QueueDock({ items, canSteer, onEdit, onRemove, onSteer, onSteerAll, className }: QueueDockProps) {
  const t = useTranslations('chat.queue')
  const describeError = useApiErrorMessage()
  const [editing, setEditing] = useState<{ uuid: string; text: string } | null>(null)
  // 正在执行的操作（uuid 或 'all'）；同一时刻只放行一个，避免重复提交。
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  if (items.length === 0) return null

  const run = async (key: string, action: () => Promise<void>): Promise<void> => {
    setBusy(key)
    setError(null)
    try {
      await action()
    } catch (failure) {
      setError(describeError(failure, 'chat.queue.failed'))
    } finally {
      setBusy(null)
    }
  }

  const saveEdit = (): void => {
    if (!editing) return
    const text = editing.text.trim()
    if (!text) {
      setError(t('empty'))
      return
    }
    const { uuid } = editing
    void run(uuid, async () => {
      await onEdit(uuid, text)
      setEditing(null)
    })
  }

  const toggleExpanded = (uuid: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(uuid)) next.delete(uuid)
      else next.add(uuid)
      return next
    })
  }

  return (
    <section className={cx(styles.root, className)} aria-label={t('label')} data-testid="queue-dock">
      <header className={styles.header}>
        <span className={styles.title}>{t('title', { count: items.length })}</span>
        {canSteer ? (
          <button
            type="button"
            className={styles.steerAll}
            disabled={busy !== null}
            data-testid="queue-steer-all"
            onClick={() => void run('all', onSteerAll)}
          >
            <CornerUpRight className={styles.icon} aria-hidden="true" />
            {t('steerAll')}
          </button>
        ) : null}
      </header>
      <ul className={styles.list}>
        {items.map((item) => {
          const isEditing = editing?.uuid === item.uuid
          const isExpanded = expanded.has(item.uuid)
          return (
            <li key={item.uuid} className={styles.item} data-testid="queue-item">
              {isEditing ? (
                <div className={styles.editForm}>
                  <textarea
                    autoFocus
                    rows={2}
                    value={editing.text}
                    aria-label={t('editLabel')}
                    data-testid="queue-edit-input"
                    className={styles.editInput}
                    onChange={(event) => setEditing({ uuid: item.uuid, text: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        setEditing(null)
                      } else if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        saveEdit()
                      }
                    }}
                  />
                  <div className={styles.editActions}>
                    <button
                      type="button"
                      className={styles.save}
                      disabled={busy !== null}
                      data-testid="queue-edit-save"
                      onClick={saveEdit}
                    >
                      {t('save')}
                    </button>
                    <button type="button" className={styles.cancel} onClick={() => setEditing(null)}>
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.contentButton}
                    aria-expanded={isExpanded}
                    title={item.content}
                    onClick={() => toggleExpanded(item.uuid)}
                  >
                    <span className={styles.priority}>{t(PRIORITY_LABELS[item.priority])}</span>
                    <span className={cx(styles.content, isExpanded && styles.contentExpanded)}>{item.content}</span>
                  </button>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={t('edit')}
                      title={item.editable ? t('edit') : t('notEditable')}
                      disabled={!item.editable || busy !== null}
                      data-testid="queue-edit"
                      onClick={() => {
                        setError(null)
                        setEditing({ uuid: item.uuid, text: item.content })
                      }}
                    >
                      <Pencil className={styles.actionIcon} aria-hidden="true" />
                    </button>
                    {canSteer ? (
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={t('steer')}
                        title={t('steer')}
                        disabled={busy !== null}
                        data-testid="queue-steer"
                        onClick={() => void run(item.uuid, () => onSteer(item.uuid))}
                      >
                        <CornerUpRight className={styles.actionIcon} aria-hidden="true" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={cx(styles.iconButton, styles.removeButton)}
                      aria-label={t('remove')}
                      title={t('remove')}
                      disabled={busy !== null}
                      data-testid="queue-remove"
                      onClick={() => void run(item.uuid, () => onRemove(item.uuid))}
                    >
                      <Trash2 className={styles.actionIcon} aria-hidden="true" />
                    </button>
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ul>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </section>
  )
}
