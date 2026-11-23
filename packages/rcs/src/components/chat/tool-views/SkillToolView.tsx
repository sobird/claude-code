'use client'

/** Skill 正文：技能名徽标、参数与 forked 结果；解析不出内容时退回通用正文。 */

import { useTranslations } from 'next-intl'

import { CollapsibleOutput } from './CollapsibleOutput'
import { GenericToolBody } from './GenericToolBody'
import { skillViewModel } from './skill-model'
import type { ToolViewProps } from './types'

import styles from './SkillToolView.module.css'

export function SkillToolView({ tool }: ToolViewProps) {
  const t = useTranslations('chat')
  const model = skillViewModel(tool)
  if (!model) return <GenericToolBody tool={tool} />
  return (
    <>
      <div className={styles.meta}>
        <span className={styles.nameChip}>{model.name}</span>
      </div>
      {model.args ? (
        <>
          <p className={styles.label}>{t('skillArgs')}</p>
          <pre className={styles.args}>{model.args}</pre>
        </>
      ) : null}
      {model.result ? <CollapsibleOutput text={model.result} /> : null}
    </>
  )
}
