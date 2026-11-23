'use client'

/** Bash 正文：命令行加终端风格输出；命令缺失时退回通用正文。 */

import { bashViewModel } from './bash-model'
import { CollapsibleOutput } from './CollapsibleOutput'
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
      {model.output ? <CollapsibleOutput text={model.output} errored={model.errored} /> : null}
    </>
  )
}
