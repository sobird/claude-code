'use client'

/**
 * 归档会话确认弹窗（纯展示）。
 *
 * `activity` 为 `null` 时是普通确认；非 null 表示网关以 `409 session_active`
 * 拒绝了归档，弹窗改为列出占用项并提供“停止并归档”。请求与状态由调用方持有，
 * 列表页、移动抽屉与详情页共用同一个实例。
 */

import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import type { SessionActivityItem } from '@/lib/session-activity'

import styles from './ArchiveSessionDialog.module.css'

export interface ArchiveSessionTarget {
  id: string
  title: string | null
}

interface ArchiveSessionDialogProps {
  target: ArchiveSessionTarget | null
  /** `null` 表示普通确认；数组表示网关返回的活动清单。 */
  activity: SessionActivityItem[] | null
  pending: boolean
  error: string | null
  onClose: () => void
  onSubmit: (stopActivity: boolean) => void
}

export function ArchiveSessionDialog({
  target,
  activity,
  pending,
  error,
  onClose,
  onSubmit,
}: ArchiveSessionDialogProps) {
  const t = useTranslations('session.archive')
  const tCommon = useTranslations('common')

  function activityLabel(item: SessionActivityItem): string {
    switch (item.kind) {
      case 'work_item':
        return t('kind.work_item')
      case 'bridge':
        return t('kind.bridge')
      case 'control':
        return t('kind.control')
      default:
        return item.label
    }
  }

  const displayTitle = target?.title || target?.id || ''
  const busy = activity !== null

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next && !pending) onClose()
      }}
    >
      <DialogContent className={styles.dialog}>
        <DialogHeader>
          <DialogTitle className={styles.title}>{busy ? t('activeTitle') : t('title')}</DialogTitle>
          <DialogDescription className={styles.description}>
            {busy ? t('activeDescription') : t('description', { title: displayTitle })}
          </DialogDescription>
        </DialogHeader>

        {busy ? (
          <ul className={styles.activity}>
            {activity.map((item, index) => (
              <li key={item.id ?? `${item.kind}-${index}`} className={styles.activityItem}>
                {activityLabel(item)}
              </li>
            ))}
          </ul>
        ) : null}

        {error !== null ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {tCommon('cancel')}
          </Button>
          {busy ? (
            <Button type="button" variant="destructive" onClick={() => onSubmit(true)} disabled={pending}>
              {pending ? t('stopping') : t('stopAndArchive')}
            </Button>
          ) : (
            <Button type="button" variant="destructive" onClick={() => onSubmit(false)} disabled={pending}>
              {pending ? t('archiving') : t('confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
