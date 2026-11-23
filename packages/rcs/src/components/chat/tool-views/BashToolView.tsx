'use client'

/** Bash 正文：命令行加终端风格输出；命令缺失时退回通用正文。 */

import { cx } from '@/lib/utils'

import { bashViewModel } from './bash-model'
import { GenericToolBody } from './GenericToolBody'
import type { ToolViewProps } from './types'

import styles from './BashToolView.module.css'

export function BashToolView({ tool }: ToolViewProps) {
  const model = bashViewModel(tool)
  if (!model) return <GenericToolBody tool={tool} />
  return (
    <>
      <div className={styles.command}>
        <span className={styles.prompt} aria-hidden="true">
          $
        </span>
        <pre className={styles.commandText}>{model.command}</pre>
      </div>
      {model.description ? <p className={styles.description}>{model.description}</p> : null}
      {model.output ? (
        <pre className={cx(styles.output, model.errored && styles.outputError)}>{model.output}</pre>
      ) : null}
    </>
  )
}
