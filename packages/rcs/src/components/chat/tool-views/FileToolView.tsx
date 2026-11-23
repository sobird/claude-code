'use client'

/** 文件正文：编辑类工具展示行级差异，读取类工具展示内容；无路径时退回通用正文。 */

import { FileCode2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'

import { cx } from '@/lib/utils'

import { CollapsibleOutput } from './CollapsibleOutput'
import { clipDiff, fileViewModel, splitFold, type ReadLine } from './file-model'
import { FilePreviewDialog } from './FilePreviewDialog'
import { GenericToolBody } from './GenericToolBody'
import type { ToolViewProps } from './types'

import styles from './FileToolView.module.css'

/** 中部折叠时保留的首尾行数。 */
const HEAD_LINES = 10
const TAIL_LINES = 5

function LineRow({ line }: { line: ReadLine }) {
  return (
    <div className={styles.line}>
      <span className={styles.lineNumber} aria-hidden="true">
        {line.number}
      </span>
      <span className={styles.lineText}>{line.text || ' '}</span>
    </div>
  )
}

/**
 * Read 行号视图：长文件折叠中部，保留开头与结尾便于定位。
 *
 * 折叠时中部行仍留在 DOM 里，用 `hidden="until-found"` 收起：浏览器查找能
 * 命中被收起的行，命中触发 `beforematch` 时直接展开，不会漏掉正文。
 */
function LineNumberedView({ lines }: { lines: ReadLine[] }) {
  const t = useTranslations('chat')
  const [expanded, setExpanded] = useState(false)
  const middleRef = useRef<HTMLDivElement>(null)
  const { head, middle, tail } = splitFold(lines, HEAD_LINES, TAIL_LINES)
  const collapsible = middle.length > 0
  const open = expanded || !collapsible

  useEffect(() => {
    const el = middleRef.current
    if (!el) return
    if (open) {
      el.removeAttribute('hidden')
      return
    }
    // 服务端先渲染成普通 hidden，水合后再升级为 until-found 以支持页内查找。
    el.setAttribute('hidden', 'until-found')
    const onBeforeMatch = () => setExpanded(true)
    el.addEventListener('beforematch', onBeforeMatch)
    return () => el.removeEventListener('beforematch', onBeforeMatch)
  }, [open])

  return (
    <div className={styles.readView}>
      <pre className={styles.lineBlock}>
        {head.map((line) => (
          <LineRow key={line.number} line={line} />
        ))}
        {collapsible ? (
          <div ref={middleRef} hidden={!open}>
            {middle.map((line) => (
              <LineRow key={line.number} line={line} />
            ))}
          </div>
        ) : null}
        {tail.map((line) => (
          <LineRow key={line.number} line={line} />
        ))}
      </pre>
      {collapsible ? (
        <button type="button" className={styles.toggle} onClick={() => setExpanded(!expanded)}>
          {open ? t('collapseOutput') : t('hiddenLines', { count: middle.length })}
        </button>
      ) : null}
    </div>
  )
}

export function FileToolView({ tool }: ToolViewProps) {
  const t = useTranslations('chat')
  const [previewing, setPreviewing] = useState(false)
  const pathRef = useRef<HTMLButtonElement>(null)
  const model = fileViewModel(tool)
  const clipped = model?.hunks ? clipDiff(model.hunks) : null
  const closePreview = () => {
    setPreviewing(false)
    // 关闭后把焦点还给打开弹层的路径按钮，键盘用户不会掉到页首。
    pathRef.current?.focus()
  }
  if (!model) return <GenericToolBody tool={tool} />
  return (
    <>
      <div className={styles.pathRow}>
        <FileCode2 className={styles.pathIcon} aria-hidden="true" />
        <button ref={pathRef} type="button" className={styles.pathButton} onClick={() => setPreviewing(true)}>
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
      {clipped ? (
        <div className={styles.hunks}>
          {clipped.hunks.map(({ hunk, lines }, hunkIndex) => (
            <div key={hunkIndex} className={styles.hunk}>
              {hunk.isNewFile ? (
                <div className={styles.newFile} aria-hidden="true">
                  +
                </div>
              ) : null}
              <pre className={styles.diff}>
                {lines.map((line, lineIndex) => (
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
          {clipped.hidden > 0 ? (
            <button type="button" className={styles.toggle} onClick={() => setPreviewing(true)}>
              {t('viewFullDiff', { count: clipped.hidden })}
            </button>
          ) : null}
        </div>
      ) : model.lines ? (
        <LineNumberedView lines={model.lines} />
      ) : model.output ? (
        <CollapsibleOutput text={model.output} errored={model.errored} />
      ) : null}
      {previewing ? <FilePreviewDialog model={model} onClose={closePreview} /> : null}
    </>
  )
}
