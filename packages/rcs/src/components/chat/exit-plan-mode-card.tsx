'use client'

/**
 * Renderer for `ExitPlanMode` approval requests.
 *
 * The CLI reads the plan from disk, so the bridge permission request normally
 * carries only `allowedPrompts`. The gateway's CLI-side bridge enriches the
 * forwarded input with the plan body; when that fails the card degrades to a
 * notice instead of showing the raw JSON.
 *
 * Long plans read poorly in the pinned panel above the composer, so the card
 * keeps a compact inline gate (short preview plus the decision buttons) and
 * opens the full plan in a dialog. Closing the dialog is not a decision: the
 * inline card stays, so the request can never be lost behind a dismissed
 * overlay. Only the newest request auto-opens the dialog.
 */

import { Check, ClipboardCheck, Maximize2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'

import {
  permissionOptions,
  type PermissionDecision,
  type PermissionOption,
  type PermissionSuggestion,
} from '../../lib/permission-suggestions'
import type { PendingPermission } from '../../lib/session-reducer'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { MarkdownText } from './markdown'
import { optionDetail, optionLabel } from './permission-option-labels'

const EXIT_PLAN_MODE_TOOL_NAME = 'ExitPlanMode'

export function isExitPlanModeRequest(toolName: string): boolean {
  return toolName === EXIT_PLAN_MODE_TOOL_NAME
}

/** Approve and switch the session to auto-accept edits in one round trip. */
const ACCEPT_EDITS_SUGGESTION: PermissionSuggestion = {
  type: 'setMode',
  mode: 'acceptEdits',
  destination: 'session',
}

interface AllowedPrompt {
  tool: string
  prompt: string
}

function parseAllowedPrompts(input: Record<string, unknown>): AllowedPrompt[] {
  if (!Array.isArray(input.allowedPrompts)) return []
  return input.allowedPrompts
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      tool: typeof item.tool === 'string' ? item.tool : '',
      prompt: typeof item.prompt === 'string' ? item.prompt : '',
    }))
    .filter((item) => item.tool || item.prompt)
}

/** First non-empty lines of the plan, enough to recognize it at a glance. */
function planPreview(plan: string): string {
  return plan
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join('\n')
}

interface ExitPlanModeCardProps {
  request: PendingPermission
  onRespond?: (requestId: string, decision: PermissionDecision) => void
  /** Open the full-plan dialog on mount; the panel only sets this for the newest request. */
  autoOpen?: boolean
}

export function ExitPlanModeCard({ request, onRespond, autoOpen = false }: ExitPlanModeCardProps) {
  const t = useTranslations('chat.exitPlan')
  const tChat = useTranslations('chat')
  const tCommon = useTranslations('common')
  const [dialogOpen, setDialogOpen] = useState(autoOpen)
  const [denyOpen, setDenyOpen] = useState(false)
  const [feedback, setFeedback] = useState('')

  const plan = typeof request.toolInput.plan === 'string' ? request.toolInput.plan : ''
  const preview = useMemo(() => planPreview(plan), [plan])
  const allowedPrompts = useMemo(() => parseAllowedPrompts(request.toolInput), [request.toolInput])
  // Suggestions the CLI attached that are not already covered by the two
  // approval buttons above; echoed back unchanged.
  const extraOptions = useMemo(
    () =>
      permissionOptions(request.suggestions).filter(
        (option) => option.kind !== 'allow-once' && option.kind !== 'accept-edits',
      ),
    [request.suggestions],
  )

  const approve = (withAutoAccept: boolean) => {
    onRespond?.(request.requestId, {
      approved: true,
      ...(withAutoAccept ? { updatedPermissions: [ACCEPT_EDITS_SUGGESTION] } : {}),
    })
  }

  const applyOption = (option: PermissionOption) => {
    const suggestion = option.suggestionIndex !== null ? request.suggestions[option.suggestionIndex] : undefined
    onRespond?.(request.requestId, {
      approved: true,
      ...(suggestion ? { updatedPermissions: [suggestion] } : {}),
    })
  }

  const submitDeny = () => {
    const message = feedback.trim()
    onRespond?.(request.requestId, { approved: false, ...(message ? { message } : {}) })
  }

  const promptsSection =
    allowedPrompts.length > 0 ? (
      <div className="mt-3">
        <div className="font-display text-[11px] text-text-muted">{t('allowedPrompts')}</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {allowedPrompts.map((prompt, index) => (
            <span
              key={`${prompt.tool}-${index}`}
              className="rounded-full border border-border bg-surface-1 px-2 py-0.5 font-mono text-[11px] text-text-secondary"
            >
              {prompt.tool ? <span className="text-brand">{prompt.tool}</span> : null}
              {prompt.tool && prompt.prompt ? ' · ' : null}
              {prompt.prompt}
            </span>
          ))}
        </div>
      </div>
    ) : null

  const extraOptionsSection =
    extraOptions.length > 0 ? (
      <div className="mt-2 flex flex-wrap gap-2">
        {extraOptions.map((option) => {
          const detail = optionDetail(option)
          return (
            <Button
              key={option.id}
              type="button"
              variant="surface"
              className="h-9 gap-1.5 px-3 text-xs"
              onClick={() => applyOption(option)}
            >
              <span>{optionLabel(option, tChat)}</span>
              {detail ? <span className="font-mono text-[10px] text-text-muted">{detail}</span> : null}
            </Button>
          )
        })}
      </div>
    ) : null

  const actions = denyOpen ? (
    <div className="mt-3 space-y-1.5">
      <textarea
        className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        rows={2}
        placeholder={t('denyPlaceholder')}
        aria-label={t('deny')}
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="surface"
          className="h-9 border-warning-border/40 px-3 text-warning-text hover:bg-warning-bg hover:text-warning-text"
          onClick={submitDeny}
        >
          <X className="h-4 w-4" />
          {t('sendDeny')}
        </Button>
        <Button
          type="button"
          variant="surface"
          className="h-9 border-transparent bg-transparent px-3 shadow-none hover:bg-surface-2"
          onClick={() => {
            setDenyOpen(false)
            setFeedback('')
          }}
        >
          {tCommon('cancel')}
        </Button>
      </div>
    </div>
  ) : (
    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
      <Button type="button" variant="brand" className="h-11 sm:h-9 sm:px-4" onClick={() => approve(false)}>
        <Check className="h-4 w-4" />
        {t('approve')}
      </Button>
      <Button type="button" variant="surface" className="h-11 sm:h-9 sm:px-4" onClick={() => approve(true)}>
        {t('approveAutoAccept')}
      </Button>
      <Button
        type="button"
        variant="surface"
        className="h-11 border-warning-border/40 bg-warning-bg/40 text-warning-text hover:bg-warning-bg hover:text-warning-text sm:h-9 sm:px-4"
        onClick={() => setDenyOpen(true)}
      >
        <X className="h-4 w-4" />
        {t('deny')}
      </Button>
    </div>
  )

  return (
    <>
      <div data-testid="exit-plan-mode-card" className="rounded-xl border border-brand/30 bg-brand/5 px-3 py-3 sm:px-4">
        <div className="flex items-center gap-2 text-text-primary">
          <ClipboardCheck className="h-4 w-4 flex-shrink-0 text-brand" aria-hidden="true" />
          <span className="flex-1 font-display text-sm font-medium">{t('title')}</span>
          {plan ? (
            <Button
              type="button"
              variant="surface"
              data-testid="exit-plan-view"
              className="h-8 gap-1 px-2 text-xs"
              onClick={() => setDialogOpen(true)}
            >
              <Maximize2 className="h-3.5 w-3.5" />
              {t('viewPlan')}
            </Button>
          ) : null}
        </div>

        {plan ? (
          <p className="mt-2 line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-text-secondary">{preview}</p>
        ) : (
          <p className="mt-2 text-xs text-text-muted">{t('missingPlan')}</p>
        )}

        {promptsSection}

        {/* The dialog shows the same actions; skipping them here avoids duplicate controls. */}
        {dialogOpen ? null : (
          <>
            {extraOptionsSection}
            {actions}
          </>
        )}
      </div>

      {plan ? (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent
            data-testid="exit-plan-mode-dialog"
            className="flex max-h-[85dvh] flex-col gap-3 rounded-2xl border-border bg-surface-1 shadow-2xl sm:max-w-2xl"
          >
            <DialogHeader>
              <DialogTitle className="font-display text-lg font-semibold text-text-primary">{t('title')}</DialogTitle>
              <DialogDescription className="text-sm text-text-muted">{t('dialogDescription')}</DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border/60 bg-surface-2/70 px-3 py-2">
              <MarkdownText text={plan} />
            </div>

            {promptsSection}
            {extraOptionsSection}
            {actions}
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
