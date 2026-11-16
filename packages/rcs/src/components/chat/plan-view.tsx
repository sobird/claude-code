'use client'

/**
 * Agent plan visualization — progress bar, per-entry status, and priority badge.
 * Ported as-is from the legacy Vite `PlanView`.
 */

import { CheckCircle2, ChevronRight, Circle, Loader2 } from 'lucide-react'
import { useState } from 'react'

import type { PlanDisplayEntry, PlanEntry, PlanEntryPriority, PlanEntryStatus } from '../../lib/session-reducer'
import { cn } from '../../lib/utils'

export function PlanView({ entry }: { entry: PlanDisplayEntry }) {
  const [collapsed, setCollapsed] = useState(false)
  const { entries } = entry

  if (entries.length === 0) return null

  const completed = entries.filter((item) => item.status === 'completed').length
  const total = entries.length
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="pl-0 sm:pl-11">
      <div className="overflow-hidden rounded-xl border border-border bg-brand/5">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2.5 text-sm transition-colors hover:bg-surface-1/50"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
        >
          <ChevronRight
            className={cn('h-3 w-3 flex-shrink-0 text-text-muted transition-transform', !collapsed && 'rotate-90')}
            aria-hidden="true"
          />
          <span className="font-display text-xs font-medium text-text-secondary">执行计划</span>
          <span className="font-mono text-[10px] text-text-muted">
            {completed}/{total}
          </span>
          <div className="ml-1 mr-2 h-1 flex-1 overflow-hidden rounded-full bg-surface-1">
            <div
              className="h-full rounded-full bg-brand/70 transition-all duration-500"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <span className="font-mono text-[10px] text-text-muted">{percentage}%</span>
        </button>

        {!collapsed ? (
          <div
            className={cn('space-y-0.5 border-t border-border px-3 py-1.5', total > 5 && 'max-h-64 overflow-y-auto')}
          >
            {entries.map((planEntry) => (
              <PlanEntryRow key={`${planEntry.priority}-${planEntry.content}`} entry={planEntry} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function PlanEntryRow({ entry }: { entry: PlanEntry }) {
  return (
    <div className="flex items-start gap-2 px-1 py-1.5">
      <span className="mt-0.5 flex-shrink-0">
        <StatusIcon status={entry.status} />
      </span>
      <span
        className={cn(
          'flex-1 text-xs leading-relaxed',
          entry.status === 'completed' ? 'text-text-muted line-through' : 'text-text-secondary',
          entry.status === 'in_progress' && 'font-medium text-text-primary',
        )}
      >
        {entry.content}
      </span>
      <PriorityBadge priority={entry.priority} />
    </div>
  )
}

function StatusIcon({ status }: { status: PlanEntryStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-3.5 w-3.5 text-status-active" aria-hidden="true" />
    case 'in_progress':
      return (
        <Loader2
          className="h-3.5 w-3.5 animate-spin text-brand"
          style={{ animationDuration: '2s' }}
          aria-hidden="true"
        />
      )
    case 'pending':
    default:
      return <Circle className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
  }
}

const PRIORITY_STYLES: Record<PlanEntryPriority, string> = {
  high: 'bg-status-error/10 text-status-error dark:bg-status-error/20',
  medium: 'bg-brand/10 text-brand dark:bg-brand/20',
  low: 'bg-surface-1 text-text-muted',
}

const PRIORITY_LABELS: Record<PlanEntryPriority, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

function PriorityBadge({ priority }: { priority: PlanEntryPriority }) {
  return (
    <span
      className={cn(
        'flex-shrink-0 rounded-full px-1.5 py-0.5 font-display text-[9px] leading-none',
        PRIORITY_STYLES[priority],
      )}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  )
}
