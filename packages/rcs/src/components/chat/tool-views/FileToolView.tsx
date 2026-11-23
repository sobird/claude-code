'use client'

/** 文件正文：编辑类工具展示行级差异，读取类工具展示内容；无路径时退回通用正文。 */

import { FileCode2 } from 'lucide-react'

import { diffLines } from '@/lib/text-diff'
import { cx } from '@/lib/utils'

import { CollapsibleOutput } from './CollapsibleOutput'
import { fileViewModel } from './file-model'
import { GenericToolBody } from './GenericToolBody'
import type { ToolViewProps } from './types'

import styles from './FileToolView.module.css'

export function FileToolView({ tool }: ToolViewProps) {
  const model = fileViewModel(tool)
  if (!model) return <GenericToolBody tool={tool} />
  return (
    <>
      <div className={styles.pathRow}>
        <FileCode2 className={styles.pathIcon} aria-hidden="true" />
        <span className={styles.path}>{model.path}</span>
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
      ) : model.output ? (
        <CollapsibleOutput text={model.output} errored={model.errored} />
      ) : null}
    </>
  )
}
