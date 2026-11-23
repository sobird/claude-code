'use client'

/** Task 工具族正文：创建、更新、清单与详情四种形态。 */

import { CheckCircle2, Circle, CircleDot } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cx } from '@/lib/utils'

import { GenericToolBody } from './GenericToolBody'
import { taskViewModel, type TaskStatus } from './task-model'
import type { ToolViewProps } from './types'

import styles from './TaskToolView.module.css'

type AnyStatus = TaskStatus | 'deleted'

export function TaskToolView({ tool }: ToolViewProps) {
  const t = useTranslations('chat')
  const model = taskViewModel(tool)
  if (!model) return <GenericToolBody tool={tool} />

  switch (model.kind) {
    case 'create': {
      const hasMeta = model.taskId !== null || model.activeForm !== null
      return (
        <>
          {hasMeta ? (
            <div className={styles.meta}>
              {model.taskId ? <span className={styles.idChip}>#{model.taskId}</span> : null}
              {model.activeForm ? <span className={styles.activeChip}>{model.activeForm}</span> : null}
            </div>
          ) : null}
          {model.description ? <p className={styles.description}>{model.description}</p> : null}
        </>
      )
    }
    case 'update': {
      const extraFields = model.fields.filter((field) => field !== 'status' && field !== 'owner')
      return (
        <>
          <div className={styles.meta}>
            <span className={styles.idChip}>#{model.taskId}</span>
            <StatusBadge status={model.status} />
            {model.owner ? <span className={styles.ownerChip}>{t('taskOwner', { owner: model.owner })}</span> : null}
            {extraFields.map((field) => (
              <span key={field} className={styles.fieldChip}>
                {field}
              </span>
            ))}
          </div>
          {model.notFound ? <p className={styles.notice}>{t('taskNotFound')}</p> : null}
          {model.blockedBy.length > 0 ? (
            <p className={styles.link}>{t('taskBlockedBy', { ids: refs(model.blockedBy) })}</p>
          ) : null}
          {model.blocks.length > 0 ? (
            <p className={styles.link}>{t('taskBlocks', { ids: refs(model.blocks) })}</p>
          ) : null}
        </>
      )
    }
    case 'list':
      return model.empty ? (
        <p className={styles.notice}>{t('taskListEmpty')}</p>
      ) : (
        <ul className={styles.list}>
          {model.tasks.map((task) => (
            <li key={task.id} className={styles.item}>
              <StatusIcon status={task.status} />
              <span className={styles.idChip}>#{task.id}</span>
              <span className={cx(styles.subject, task.status === 'completed' && styles.done)}>{task.subject}</span>
              {task.owner ? <span className={styles.ownerChip}>{task.owner}</span> : null}
              {task.blockedBy.length > 0 ? (
                <span className={styles.link}>{t('taskBlockedBy', { ids: refs(task.blockedBy) })}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )
    case 'get':
      return model.task === null ? (
        <p className={styles.notice}>{t('taskNotFound')}</p>
      ) : (
        <>
          <div className={styles.meta}>
            <span className={styles.idChip}>#{model.task.id}</span>
            <StatusBadge status={model.task.status} />
            {model.task.blockedBy.length > 0 ? (
              <span className={styles.link}>{t('taskBlockedBy', { ids: refs(model.task.blockedBy) })}</span>
            ) : null}
            {model.task.blocks.length > 0 ? (
              <span className={styles.link}>{t('taskBlocks', { ids: refs(model.task.blocks) })}</span>
            ) : null}
          </div>
          <p className={styles.subject}>{model.task.subject}</p>
          {model.task.description ? <p className={styles.description}>{model.task.description}</p> : null}
        </>
      )
  }
}

function StatusBadge({ status }: { status: AnyStatus | null }) {
  const t = useTranslations('chat')
  if (!status) return null
  const label =
    status === 'completed'
      ? t('taskStatusCompleted')
      : status === 'in_progress'
        ? t('taskStatusInProgress')
        : status === 'deleted'
          ? t('taskStatusDeleted')
          : t('taskStatusPending')
  return <span className={cx(styles.statusChip, styles[status])}>{label}</span>
}

function StatusIcon({ status }: { status: TaskStatus | null }) {
  const t = useTranslations('chat')
  const label =
    status === 'completed'
      ? t('taskStatusCompleted')
      : status === 'in_progress'
        ? t('taskStatusInProgress')
        : t('taskStatusPending')
  const Icon = status === 'completed' ? CheckCircle2 : status === 'in_progress' ? CircleDot : Circle
  return (
    <Icon
      role="img"
      aria-label={label}
      className={cx(
        styles.icon,
        status === 'completed' && styles.iconDone,
        status === 'in_progress' && styles.iconCurrent,
      )}
    />
  )
}

function refs(ids: string[]): string {
  return ids.map((id) => `#${id}`).join(', ')
}
