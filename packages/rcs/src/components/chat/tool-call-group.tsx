'use client'

/**
 * Tool-call cards. Adjacent calls collapse into one summary row; each card
 * expands to reveal the raw input/output. Ported from the legacy Vite UI.
 */

import { Check, ChevronRight, Loader2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import type { ToolCallData, ToolCallEntry, ToolCallStatus } from '../../lib/session-reducer'
import { cn, uniqueKeys } from '../../lib/utils'
import { Button } from '../ui/button'

type ChatTranslator = ReturnType<typeof useTranslations<'chat'>>

interface ToolCallGroupProps {
  entries: ToolCallEntry[]
  onPermissionRespond?: (requestId: string, approved: boolean) => void
}

/** Renders a single tool card, or a collapsible group when calls are adjacent. */
export function ToolCallGroup({ entries, onPermissionRespond }: ToolCallGroupProps) {
  const t = useTranslations('chat')
  const [expanded, setExpanded] = useState(false)

  if (entries.length === 0) return null

  if (entries.length === 1) {
    const only = entries[0]
    return (
      <div className="pl-0 sm:pl-11">
        {only ? <SingleToolCard tool={only.toolCall} compact onPermissionRespond={onPermissionRespond} /> : null}
      </div>
    )
  }

  return (
    <div className="pl-0 sm:pl-11">
      <div className="overflow-hidden rounded-lg border border-border bg-surface-2/60">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-1/60"
          onClick={() => setExpanded(!expanded)}
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
              <SingleToolCard key={key} tool={item.toolCall} compact onPermissionRespond={onPermissionRespond} />
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
  onPermissionRespond?: (requestId: string, approved: boolean) => void
}

function SingleToolCard({ tool, compact, onPermissionRespond }: SingleToolCardProps) {
  const t = useTranslations('chat')
  const [expanded, setExpanded] = useState(!compact)
  const hasOutput =
    tool.status !== 'running' &&
    tool.status !== 'waiting_for_confirmation' &&
    (tool.rawOutput !== undefined || tool.status === 'error')
  const requestId = tool.permissionRequest?.requestId

  return (
    <div className={cn('px-3', compact ? 'py-1.5' : 'py-2')}>
      <button
        type="button"
        className="group flex w-full items-center gap-2 text-left"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <StatusIcon status={tool.status} />
        <span className="truncate font-display text-xs font-medium text-text-secondary transition-colors group-hover:text-text-primary">
          {tool.title || t('toolFallback')}
        </span>
        {tool.status === 'running' ? (
          <span className="animate-pulse text-[10px] text-status-running">{t('running')}</span>
        ) : null}
        {tool.status === 'waiting_for_confirmation' ? (
          <span className="text-[10px] text-brand">{t('waiting')}</span>
        ) : null}
      </button>

      {tool.status === 'waiting_for_confirmation' && requestId ? (
        <div className="mt-2 flex gap-2 sm:ml-5">
          <Button
            type="button"
            size="sm"
            variant="brand"
            className="h-10 flex-1 sm:h-8 sm:flex-none"
            onClick={() => onPermissionRespond?.(requestId, true)}
          >
            <Check className="h-4 w-4" />
            {t('allow')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-10 flex-1 border-warning-border/40 text-warning-text sm:h-8 sm:flex-none"
            onClick={() => onPermissionRespond?.(requestId, false)}
          >
            <X className="h-4 w-4" />
            {t('deny')}
          </Button>
        </div>
      ) : null}

      {expanded ? (
        <div className="mt-2 space-y-2 sm:ml-5">
          {tool.rawInput && Object.keys(tool.rawInput).length > 0 ? (
            <pre className="max-h-36 overflow-x-auto rounded-md bg-surface-1 p-2 font-mono text-[11px] text-text-secondary">
              {truncate(JSON.stringify(tool.rawInput, null, 2), 2000)}
            </pre>
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
    const name = simplifyToolName(entry.toolCall.title)
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

function simplifyToolName(title: string): string {
  const match = title.match(/^(\w+)/)
  return match ? (match[1] ?? title) : title
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
