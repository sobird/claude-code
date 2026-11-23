'use client'

/** 文件正文：编辑类工具展示行级差异，读取类工具展示内容；无路径时退回通用正文。 */

import { FileCode2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { diffLines } from '@/lib/text-diff'
import { cx } from '@/lib/utils'

import { CollapsibleOutput } from './CollapsibleOutput'
import { fileViewModel, type ReadLine } from './file-model'
import { FilePreviewDialog } from './FilePreviewDialog'
import { OUTPUT_MAX_LINES } from './format'
import { GenericToolBody } from './GenericToolBody'
import type { ToolViewProps } from './types'

import styles from './FileToolView.module.css'

/** 中部折叠时保留的首尾行数。 */
const HEAD_LINES = 10
const TAIL_LINES = 5

/** Read 行号视图：长文件折叠中部，保留开头与结尾便于定位。 */
function LineNumberedView({ lines }: { lines: ReadLine[] }) {
  const t = useTranslations('chat')
  const [expanded, setExpanded] = useState(false)
  const collapsible = lines.length > OUTPUT_MAX_LINES
  const open = expanded || !collapsible
  const visible = open ? lines : [...lines.slice(0, HEAD_LINES), ...lines.slice(-TAIL_LINES)]
  return (
    <div className={styles.readView}>
      <pre className={styles.lineBlock}>
        {visible.map((line) => (
          <div key={line.number} className={styles.line}>
            <span className={styles.lineNumber} aria-hidden="true">
              {line.number}
            </span>
            <span className={styles.lineText}>{line.text || ' '}</span>
          </div>
        ))}
      </pre>
      {collapsible ? (
        <button type="button" className={styles.toggle} onClick={() => setExpanded(!expanded)}>
          {open ? t('collapseOutput') : t('hiddenLines', { count: lines.length - HEAD_LINES - TAIL_LINES })}
        </button>
      ) : null}
    </div>
  )
}

export function FileToolView({ tool }: ToolViewProps) {
  const [previewing, setPreviewing] = useState(false)
  const model = fileViewModel(tool)
  if (!model) return <GenericToolBody tool={tool} />
  return (
    <>
      <div className={styles.pathRow}>
        <FileCode2 className={styles.pathIcon} aria-hidden="true" />
        <button type="button" className={styles.pathButton} onClick={() => setPreviewing(true)}>
          {model.path}
        </button>
      </div>
      {model.images.length > 0 ? (
        <div className={styles.images}>
          {model.images.map((image, imageIndex) => (
            <img
              key={imageIndex}
              className={styles.image}
              src={`data:${image.mediaType};base64,${image.data}`}
              alt={`${model.path} #${imageIndex + 1}`}
              loading="lazy"
            />
          ))}
        </div>
      ) : null}
      {model.hunks ? (
        <div className={styles.hunks}>
          {model.hunks.map((hunk, hunkIndex) => (
            <div key={hunkIndex} className={styles.hunk}>
              {hunk.isNewFile ? (
                <div className={styles.newFile} aria-hidden="true">
                  +
                </div>
              ) : null}
              <pre className={styles.diff}>
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
            </div>
          ))}
        </div>
      ) : model.lines ? (
        <LineNumberedView lines={model.lines} />
      ) : model.output ? (
        <CollapsibleOutput text={model.output} errored={model.errored} />
      ) : null}
      {previewing ? <FilePreviewDialog model={model} onClose={() => setPreviewing(false)} /> : null}
    </>
  )
}
