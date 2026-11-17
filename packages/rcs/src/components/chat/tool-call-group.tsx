'use client'

/**
 * Tool-call cards. Adjacent calls collapse into one summary row; each card
 * expands to reveal the raw input/output. Ported from the legacy Vite UI.
 */

import { Check, ChevronRight, Loader2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import type { ToolCallData, ToolCallEntry, ToolCallStatus } from '../../lib/session-reducer'
import { canonicalToolName, summarizeToolCall } from '../../lib/tool-summary'
import { cn, uniqueKeys } from '../../lib/utils'

type ChatTranslator = ReturnType<typeof useTranslations<'chat'>>

interface ToolCallGroupProps {
  entries: ToolCallEntry[]
  /** Header-level "expand all" toggle; individual cards can still override it. */
  expandAll?: boolean
}

/** Renders a single tool card, or a collapsible group when calls are adjacent. */
export function ToolCallGroup({ entries, expandAll = false }: ToolCallGroupProps) {
  const t = useTranslations('chat')
  // `null` follows the global toggle; clicking a card pins its own state until
  // the global toggle changes again.
  const [override, setOverride] = useState<boolean | null>(null)
  const expanded = override ?? expandAll
  useEffect(() => setOverride(null), [expandAll])

  if (entries.length === 0) return null

  if (entries.length === 1) {
    const only = entries[0]
    return (
      <div className="pl-0 sm:pl-11">
        {only ? <SingleToolCard tool={only.toolCall} compact expandAll={expandAll} /> : null}
      </div>
    )
  }

  return (
    <div className="pl-0 sm:pl-11">
      <div className="overflow-hidden rounded-lg border border-border bg-surface-2/60">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-1/60"
          onClick={() => setOverride(!expanded)}
        >
          <ChevronRight
            className={cn('h-3 w-3 text-text-muted transition-transform', expanded && 'rotate-90')}
            aria-hidden="true"
          />
          <span className="font-display text-xs text-text-muted">{buildSummary(entries, t)}</span>
        </button>
        {expanded ? (
          <div className="divide-y divide-border border-t border-border">
            {uniqueKeys(entries, (entry) => entry.toolCall.id).map(({ item, key }) => (
              <SingleToolCard key={key} tool={item.toolCall} compact expandAll={expandAll} />
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
}

function SingleToolCard({ tool, compact, expandAll = false }: SingleToolCardProps) {
  const t = useTranslations('chat')
  const [override, setOverride] = useState<boolean | null>(null)
  // Compact cards start collapsed; standalone (non-compact) cards start open.
  const expanded = override ?? (expandAll || !compact)
  useEffect(() => setOverride(null), [expandAll])
  const summary = summarizeToolCall(tool.title, tool.rawInput)
  const hasOutput =
    tool.status !== 'running' &&
    tool.status !== 'waiting_for_confirmation' &&
    (tool.rawOutput !== undefined || tool.status === 'error')

  return (
    <div className={cn('px-3', compact ? 'py-1.5' : 'py-2')}>
      <button
        type="button"
        className="group flex w-full items-center gap-2 text-left"
        onClick={() => setOverride(!expanded)}
        aria-expanded={expanded}
      >
        <StatusIcon status={tool.status} />
        <span className="truncate font-display text-xs font-medium text-text-secondary transition-colors group-hover:text-text-primary">
          {summary.name || t('toolFallback')}
          {summary.summary ? <span className="ml-1.5 font-normal text-text-muted">{summary.summary}</span> : null}
        </span>
        {tool.status === 'running' ? (
          <span className="animate-pulse text-[10px] text-status-running">{t('running')}</span>
        ) : null}
        {tool.status === 'waiting_for_confirmation' ? (
          <span className="text-[10px] text-brand">{t('waiting')}</span>
        ) : null}
      </button>

      {expanded ? (
        <div className="mt-2 space-y-2 sm:ml-5">
          {summary.fields.length > 0 ? (
            <div className="space-y-1 rounded-md bg-surface-1 p-2 font-mono text-[11px] text-text-secondary">
              {summary.fields.map((field) => (
                <div key={field.key} className="flex gap-2 whitespace-pre-wrap break-words">
                  <span className="flex-shrink-0 text-text-muted">{field.key}</span>
                  <span className="min-w-0">{field.value}</span>
                </div>
              ))}
            </div>
          ) : null}
          {tool.rawInput && Object.keys(tool.rawInput).length > 0 ? (
            <details>
              <summary className="cursor-pointer list-none font-display text-[11px] text-text-muted transition-colors hover:text-text-secondary">
                {t('toolRawInput')}
              </summary>
              <pre className="mt-1 max-h-36 overflow-x-auto rounded-md bg-surface-1 p-2 font-mono text-[11px] text-text-secondary">
                {truncate(JSON.stringify(tool.rawInput, null, 2), 2000)}
              </pre>
            </details>
          ) : null}
          {hasOutput ? (
            <pre
              className={cn(
                'max-h-36 overflow-x-auto rounded-md p-2 font-mono text-[11px]',
                tool.status === 'error' ? 'bg-status-error/10 text-status-error' : 'bg-surface-1 text-text-secondary',
              )}
            >
              {formatOutput(tool)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function StatusIcon({ status }: { status: ToolCallStatus }) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-status-running" aria-hidden="true" />
    case 'complete':
      return <Check className="h-3.5 w-3.5 flex-shrink-0 text-status-active" aria-hidden="true" />
    case 'error':
    case 'rejected':
      return <X className="h-3.5 w-3.5 flex-shrink-0 text-status-error" aria-hidden="true" />
    case 'waiting_for_confirmation':
      return <span className="flex-shrink-0 text-[11px] leading-none text-brand">?</span>
    case 'canceled':
      return <span className="flex-shrink-0 text-[11px] leading-none text-text-muted">—</span>
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

function formatOutput(tool: ToolCallData): string {
  if (tool.rawOutput && Object.keys(tool.rawOutput).length > 0) {
    const output = tool.rawOutput.output
    if (typeof output === 'string') return truncate(output, 2000)
    return truncate(JSON.stringify(tool.rawOutput, null, 2), 2000)
  }
  return ''
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}
