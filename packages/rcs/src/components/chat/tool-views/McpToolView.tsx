'use client'

/** MCP 工具正文：server/tool 徽标、透传输入的键值表、图片预览与可折叠输出。 */

import { Plug } from 'lucide-react'

import { CollapsibleOutput } from './CollapsibleOutput'
import { GenericToolBody } from './GenericToolBody'
import { mcpViewModel } from './mcp-model'
import type { ToolViewProps } from './types'

import styles from './McpToolView.module.css'

export function McpToolView({ tool }: ToolViewProps) {
  const model = mcpViewModel(tool)
  if (!model) return <GenericToolBody tool={tool} />
  return (
    <>
      <div className={styles.meta}>
        <Plug className={styles.icon} aria-hidden="true" />
        <span className={styles.serverChip}>{model.server}</span>
        <span className={styles.toolName}>{model.tool}</span>
      </div>
      {model.input.length > 0 ? (
        <div className={styles.fields}>
          {model.input.map((field) => (
            <div key={field.key} className={styles.fieldRow}>
              <span className={styles.fieldKey}>{field.key}</span>
              <span className={styles.fieldValue}>{field.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {model.images.length > 0 ? (
        <div className={styles.images}>
          {model.images.map((image, index) => (
            <img
              key={index}
              className={styles.image}
              src={`data:${image.mediaType};base64,${image.data}`}
              alt={`${model.tool} #${index + 1}`}
              loading="lazy"
            />
          ))}
        </div>
      ) : null}
      {model.output || model.errored ? <CollapsibleOutput text={model.output} errored={model.errored} /> : null}
    </>
  )
}
