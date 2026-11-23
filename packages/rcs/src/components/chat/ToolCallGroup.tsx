'use client'

/**
 * Tool-call cards. Adjacent calls collapse into one summary row; each card
 * expands to reveal the raw input/output. Ported from the legacy Vite UI.
 */

import { Check, ChevronRight, Loader2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import type {
  AssistantMessageEntry,
  ThreadEntry,
  ToolCallData,
  ToolCallEntry,
  ToolCallStatus,
} from '@/lib/session-reducer'
import { canonicalToolName, summarizeToolCall } from '@/lib/tool-summary'
import { cx, uniqueKeys } from '@/lib/utils'

import { AssistantBubble } from './MessageBubble'
import { bashViewModel } from './tool-views/bash-model'
import { diffStats, fileViewModel, formatInputSize } from './tool-views/file-model'
import { GenericToolBody } from './tool-views/GenericToolBody'
import { toolViewKind } from './tool-views/kinds'
import { TOOL_VIEWS } from './tool-views/registry'

import styles from './ToolCallGroup.module.css'

type ChatTranslator = ReturnType<typeof useTranslations<'chat'>>

interface ToolCallGroupProps {
  entries: ToolCallEntry[]
  /** Header-level "expand all" toggle; individual cards can still override it. */
  expandAll?: boolean
  /**
   * Parent-controlled expansion (the keyboard cursor toggles a group with
   * Enter). When provided, clicking the group header defers to
   * `onToggleExpanded` instead of the internal override.
   */
  expanded?: boolean
  onToggleExpanded?: () => void
  /**
   * Subagent traffic keyed by its parent Agent tool id. Nested here rather than
   * surfaced as separate transcript rows, so an agent's work reads as one card.
   */
  childrenByParent?: Map<string, ThreadEntry[]>
}

/** Renders a single tool card, or a collapsible group when calls are adjacent. */
export function ToolCallGroup({
  entries,
  expandAll = false,
  expanded: controlled,
  onToggleExpanded,
  childrenByParent,
}: ToolCallGroupProps) {
  const t = useTranslations('chat')
  // `null` follows the global toggle; clicking a card pins its own state until
  // the global toggle changes again.
  const [override, setOverride] = useState<boolean | null>(null)
  const expanded = controlled ?? override ?? expandAll
  useEffect(() => setOverride(null), [expandAll])

  const toggle = () => {
    if (controlled !== undefined) {
      onToggleExpanded?.()
      return
    }
    setOverride(!expanded)
  }

  if (entries.length === 0) return null

  if (entries.length === 1) {
    const only = entries[0]
    return (
      <div className={styles.root}>
        {only ? (
          <SingleToolCard
            tool={only.toolCall}
            compact
            expandAll={expandAll}
            expanded={controlled}
            onToggle={controlled !== undefined ? onToggleExpanded : undefined}
            subagentEntries={childrenByParent?.get(only.toolCall.id)}
            childrenByParent={childrenByParent}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <div className={styles.groupBox}>
        <button type="button" className={styles.groupHeader} onClick={toggle}>
          <ChevronRight className={cx(styles.groupChevron, expanded && styles.groupChevronOpen)} aria-hidden="true" />
          <span className={styles.groupSummary}>{buildSummary(entries, t)}</span>
        </button>
        {expanded ? (
          <div className={styles.groupBody}>
            {uniqueKeys(entries, (entry) => entry.toolCall.id).map(({ item, key }) => (
              <SingleToolCard
                key={key}
                tool={item.toolCall}
                compact
                expandAll={expandAll}
                subagentEntries={childrenByParent?.get(item.toolCall.id)}
                childrenByParent={childrenByParent}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

interface SingleToolCardProps {
  tool: ToolCallData
  compact?: boolean
  expandAll?: boolean
  /** Parent-controlled expansion for a single-card group (keyboard cursor). */
  expanded?: boolean
  onToggle?: () => void
  /** Subagent transcript this call produced (keyed by its id). */
  subagentEntries?: ThreadEntry[]
  childrenByParent?: Map<string, ThreadEntry[]>
}

function SingleToolCard({
  tool,
  compact,
  expandAll = false,
  expanded: controlled,
  onToggle,
  subagentEntries,
  childrenByParent,
}: SingleToolCardProps) {
  const t = useTranslations('chat')
  const [override, setOverride] = useState<boolean | null>(null)
  // Compact cards start collapsed; standalone (non-compact) cards start open.
  const expanded = controlled ?? override ?? (expandAll || !compact)
  useEffect(() => setOverride(null), [expandAll])
  const toggle = () => {
    if (controlled !== undefined) {
      onToggle?.()
      return
    }
    setOverride(!expanded)
  }
  const summary = summarizeToolCall(tool.title, tool.rawInput)
  const kind = toolViewKind(tool.title)
  const ToolView = kind ? TOOL_VIEWS[kind] : undefined
  const fileModel = kind === 'file' ? fileViewModel(tool) : null
  const hunks = fileModel?.hunks ?? undefined
  const stats = hunks ? diffStats(hunks) : null
  const inputSize = fileModel?.inputSize ?? null
  const exitCode = kind === 'bash' ? (bashViewModel(tool)?.exitCode ?? null) : null
  // running/waiting 已有可见标签；其余终态补一条视觉隐藏文本供屏幕阅读器读取。
  const statusLabel =
    tool.status === 'complete'
      ? t('toolStatusDone')
      : tool.status === 'error'
        ? t('toolStatusError')
        : tool.status === 'rejected'
          ? t('toolStatusRejected')
          : tool.status === 'canceled'
            ? t('toolStatusCanceled')
            : null

  return (
    <div className={cx(styles.card, compact ? styles.cardCompact : styles.cardRoomy)}>
      <button type="button" className={styles.cardHeaderButton} onClick={toggle} aria-expanded={expanded}>
        <StatusIcon status={tool.status} />
        <span className={styles.cardTitle}>
          <span className={tool.status === 'running' ? styles.shimmer : undefined}>
            {summary.name || t('toolFallback')}
          </span>
          {summary.summary ? <span className={styles.cardTitleSuffix}>{summary.summary}</span> : null}
          {stats && (stats.added > 0 || stats.removed > 0) ? (
            <span className={styles.diffStat} aria-label={t('diffStatAria', stats)}>
              <span className={styles.diffAdded} aria-hidden="true">{`+${stats.added}`}</span>
              <span className={styles.diffRemoved} aria-hidden="true">{`-${stats.removed}`}</span>
            </span>
          ) : null}
          {inputSize !== null ? <span className={styles.inputSize}>{formatInputSize(inputSize)}</span> : null}
          {exitCode !== null ? <span className={styles.exitCode}>{t('exitCode', { code: exitCode })}</span> : null}
        </span>
        {tool.status === 'running' ? <span className={styles.runningLabel}>{t('running')}</span> : null}
        {tool.status === 'waiting_for_confirmation' ? (
          <span className={styles.waitingLabel}>{t('waiting')}</span>
        ) : null}
        {statusLabel ? <span className={styles.visuallyHidden}>{statusLabel}</span> : null}
        {subagentEntries && subagentEntries.length > 0 ? (
          <span className={styles.agentSteps}>{t('agentSteps', { count: subagentEntries.length })}</span>
        ) : null}
      </button>

      {expanded ? (
        <div className={styles.cardBody}>
          {ToolView ? <ToolView tool={tool} /> : <GenericToolBody tool={tool} />}
          {subagentEntries && subagentEntries.length > 0 ? (
            <div className={styles.subagent}>
              <SubagentTranscript entries={subagentEntries} expandAll={expandAll} childrenByParent={childrenByParent} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The visible trace of an Agent call: its assistant text and nested tool
 * cards. Subagent user turns are tool-result carriers (no bubble), and
 * plan/system rows belong to the main thread, so both are skipped.
 */
function SubagentTranscript({
  entries,
  expandAll,
  childrenByParent,
}: {
  entries: ThreadEntry[]
  expandAll: boolean
  childrenByParent?: Map<string, ThreadEntry[]>
}) {
  const visible = entries.filter(
    (entry): entry is AssistantMessageEntry | ToolCallEntry =>
      entry.type === 'assistant_message' || entry.type === 'tool_call',
  )
  if (visible.length === 0) return null
  return (
    <>
      {uniqueKeys(visible, (entry) => (entry.type === 'tool_call' ? entry.toolCall.id : entry.id)).map(
        ({ item, key }) =>
          item.type === 'assistant_message' ? (
            <AssistantBubble key={key} entry={item} />
          ) : (
            <ToolCallGroup key={key} entries={[item]} expandAll={expandAll} childrenByParent={childrenByParent} />
          ),
      )}
    </>
  )
}

function StatusIcon({ status }: { status: ToolCallStatus }) {
  switch (status) {
    case 'running':
      return <Loader2 className={cx(styles.statusIcon, styles.runningIcon)} aria-hidden="true" />
    case 'complete':
      return <Check className={cx(styles.statusIcon, styles.activeIcon)} aria-hidden="true" />
    case 'error':
    case 'rejected':
      return <X className={cx(styles.statusIcon, styles.errorIcon)} aria-hidden="true" />
    case 'waiting_for_confirmation':
      return <span className={cx(styles.statusGlyph, styles.brand)}>?</span>
    case 'canceled':
      return <span className={cx(styles.statusGlyph, styles.muted)}>—</span>
    default:
      return null
  }
}

/**
 * Counts calls per simplified tool name, preserving first-seen order so the
 * summary reads in the order the agent made the calls.
 */
export function summarizeTools(entries: ToolCallEntry[]): {
  total: number
  groups: Array<{ name: string; count: number }>
} {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    const name = canonicalToolName(entry.toolCall.title)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return { total: entries.length, groups: [...counts].map(([name, count]) => ({ name, count })) }
}

function buildSummary(entries: ToolCallEntry[], t: ChatTranslator): string {
  const { total, groups } = summarizeTools(entries)
  if (groups.length === 0) return t('summary.total', { count: total })

  const parts = groups.map((group) => {
    const name = group.name || t('toolFallback')
    return group.count === 1 ? name : t('summary.group', { count: group.count, name })
  })

  if (parts.length === 1) return parts[0] ?? ''
  return t('summary.grouped', { total, tools: parts.join(', ') })
}
