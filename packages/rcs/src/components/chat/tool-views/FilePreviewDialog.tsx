'use client'

/** 文件查看弹层：展示该卡片对应的最近一次内容（Read 行号 / 编辑 diff / Write 全文 / 文本输出）。 */

import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'

import { diffLines } from '@/lib/text-diff'
import { cx } from '@/lib/utils'

import { previewBodyKind, type FileViewModel } from './file-model'

import styles from './FilePreviewDialog.module.css'

export function FilePreviewDialog({ model, onClose }: { model: FileViewModel; onClose: () => void }) {
  const t = useTranslations('chat')
  const body = previewBodyKind(model)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.backdrop}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={model.path}>
        <header className={styles.header}>
          <span className={styles.title}>{model.path}</span>
          <button type="button" className={styles.close} aria-label={t('filePreviewClose')} onClick={onClose} autoFocus>
            <X className={styles.closeIcon} aria-hidden="true" />
          </button>
        </header>
        <div className={styles.body}>
          {body === 'lines' && model.lines ? (
            <pre className={styles.lines}>
              {model.lines.map((line) => (
                <div key={line.number} className={styles.line}>
                  <span className={styles.lineNumber} aria-hidden="true">
                    {line.number}
                  </span>
                  <span className={styles.lineText}>{line.text || ' '}</span>
                </div>
              ))}
            </pre>
          ) : body === 'diff' && model.hunks ? (
            <div className={styles.diffs}>
              {model.hunks.map((hunk, hunkIndex) => (
                <pre key={hunkIndex} className={styles.diff}>
                  {diffLines(hunk.before, hunk.after).map((line, lineIndex) => (
                    <div
                      key={lineIndex}
                      className={cx(
                        styles.diffLine,
                        line.type === 'add' && styles.diffAdd,
                        line.type === 'remove' && styles.diffRemove,
                        line.type === 'context' && styles.diffContext,
                      )}
                    >
                      {line.type === 'add' ? '+ ' : line.type === 'remove' ? '- ' : '  '}
                      {line.text}
                    </div>
                  ))}
                </pre>
              ))}
            </div>
          ) : body === 'text' ? (
            <pre className={styles.plain}>{model.writtenContent}</pre>
          ) : body === 'output' ? (
            <pre className={styles.plain}>{model.output}</pre>
          ) : null}
        </div>
      </div>
    </div>
  )
}
