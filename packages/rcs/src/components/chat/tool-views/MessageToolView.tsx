'use client'

/** 消息类正文：Brief 的留言与附件、SendMessage 的收件人/摘要/正文。 */

import { useTranslations } from 'next-intl'

import { CollapsibleOutput } from './CollapsibleOutput'
import { GenericToolBody } from './GenericToolBody'
import { messageViewModel } from './message-model'
import type { ToolViewProps } from './types'

import styles from './MessageToolView.module.css'

export function MessageToolView({ tool }: ToolViewProps) {
  const t = useTranslations('chat')
  const model = messageViewModel(tool)
  if (!model) return <GenericToolBody tool={tool} />

  if (model.kind === 'brief') {
    return (
      <>
        {model.attachments > 0 || model.delivered ? (
          <div className={styles.meta}>
            {model.attachments > 0 ? (
              <span className={styles.chip}>{t('messageAttachments', { count: model.attachments })}</span>
            ) : null}
            {model.delivered ? <span className={styles.delivered}>{t('messageDelivered')}</span> : null}
          </div>
        ) : null}
        <p className={styles.body}>{model.message}</p>
      </>
    )
  }

  return (
    <>
      <div className={styles.meta}>
        {model.to ? <span className={styles.toChip}>→ {model.to}</span> : null}
        {model.recipients.length > 0 ? (
          <span className={styles.chip}>{t('messageBroadcast', { count: model.recipients.length })}</span>
        ) : null}
      </div>
      {model.summary ? <p className={styles.summary}>{model.summary}</p> : null}
      {model.body ? <CollapsibleOutput text={model.body} /> : null}
      {model.success === false && model.result ? <p className={styles.notice}>{model.result}</p> : null}
    </>
  )
}
