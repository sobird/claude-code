'use client'

/** Agent（Task）正文：类型与用量元信息、折叠的 prompt、剥离尾注后的报告。 */

import { useTranslations } from 'next-intl'

import { agentViewModel, formatDurationMs } from './agent-model'
import { CollapsibleOutput } from './CollapsibleOutput'
import { GenericToolBody } from './GenericToolBody'
import type { ToolViewProps } from './types'

import styles from './AgentToolView.module.css'

/** 固定 locale，避免不同运行时环境下的千分位差异。 */
const TOKENS = new Intl.NumberFormat('en-US')

export function AgentToolView({ tool }: ToolViewProps) {
  const t = useTranslations('chat')
  const model = agentViewModel(tool)
  const hasMeta = model.subagentType !== null || model.usage !== null || model.launched
  if (!hasMeta && model.prompt === null && !model.output) return <GenericToolBody tool={tool} />

  const waiting = tool.status === 'running' || tool.status === 'waiting_for_confirmation'
  return (
    <>
      {hasMeta ? (
        <div className={styles.meta}>
          {model.subagentType ? <span className={styles.typeChip}>{model.subagentType}</span> : null}
          {model.usage ? (
            <span className={styles.usage}>
              {t('agentUsage', {
                tokens: TOKENS.format(model.usage.totalTokens),
                tools: model.usage.toolUses,
                duration: formatDurationMs(model.usage.durationMs),
              })}
            </span>
          ) : null}
          {model.launched ? <span className={styles.launchedChip}>{t('agentLaunched')}</span> : null}
        </div>
      ) : null}
      {model.prompt ? (
        <details>
          <summary className={styles.promptSummary}>{t('agentPrompt')}</summary>
          <pre className={styles.promptPre}>{model.prompt}</pre>
        </details>
      ) : null}
      {!waiting && model.output ? <CollapsibleOutput text={model.output} errored={model.errored} /> : null}
    </>
  )
}
