'use client'

/** 后台任务正文：TaskOutput 读取结果与 TaskStop 终止结果；解析不出内容时退回通用正文。 */

import { useTranslations } from 'next-intl'

import { cx } from '@/lib/utils'

import { backgroundTaskViewModel, type TaskRunStatus } from './background-task-model'
import { CollapsibleOutput } from './CollapsibleOutput'
import { GenericToolBody } from './GenericToolBody'
import type { ToolViewProps } from './types'

import styles from './BackgroundTaskToolView.module.css'

export function BackgroundTaskToolView({ tool }: ToolViewProps) {
  const t = useTranslations('chat')
  const model = backgroundTaskViewModel(tool)
  if (!model) return <GenericToolBody tool={tool} />
  if (model.kind === 'message') return <p className={styles.notice}>{model.text}</p>

  const typeLabel =
    model.taskType === 'local_bash'
      ? t('taskTypeShell')
      : model.taskType === 'local_agent'
        ? t('taskTypeAgent')
        : model.taskType === 'remote_agent'
          ? t('taskTypeRemote')
          : model.taskType

  if (model.kind === 'stop') {
    return (
      <>
        <div className={styles.meta}>
          {model.taskId ? <span className={styles.idChip}>{model.taskId}</span> : null}
          {typeLabel ? <span className={styles.typeChip}>{typeLabel}</span> : null}
          {model.stopped ? <span className={styles.stoppedChip}>{t('taskStopped')}</span> : null}
        </div>
        {model.command ? <pre className={styles.command}>{model.command}</pre> : null}
      </>
    )
  }

  return (
    <>
      <div className={styles.meta}>
        {model.taskId ? <span className={styles.idChip}>{model.taskId}</span> : null}
        {typeLabel ? <span className={styles.typeChip}>{typeLabel}</span> : null}
        <StatusBadge status={model.status} />
        {model.exitCode !== null ? (
          <span className={styles.exitChip}>{t('exitCode', { code: model.exitCode })}</span>
        ) : null}
      </div>
      {model.retrieval === 'timeout' ? <p className={styles.notice}>{t('taskOutputTimeout')}</p> : null}
      {model.retrieval === 'not_ready' ? <p className={styles.notice}>{t('taskOutputNotReady')}</p> : null}
      {model.error ? <p className={styles.error}>{model.error}</p> : null}
      {model.output ? <CollapsibleOutput text={model.output} errored={tool.status === 'error'} /> : null}
    </>
  )
}

function StatusBadge({ status }: { status: TaskRunStatus | null }) {
  const t = useTranslations('chat')
  if (!status) return null
  const label =
    status === 'running'
      ? t('backgroundTasks.status.running')
      : status === 'pending'
        ? t('backgroundTasks.status.pending')
        : status === 'completed'
          ? t('backgroundTasks.status.completed')
          : status === 'failed'
            ? t('backgroundTasks.status.failed')
            : status === 'stopped'
              ? t('backgroundTasks.status.stopped')
              : t('backgroundTasks.status.killed')
  return <span className={cx(styles.statusChip, styles[status])}>{label}</span>
}
