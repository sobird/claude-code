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
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import {
  permissionOptions,
  type PermissionDecision,
  type PermissionOption,
  type PermissionSuggestion,
} from '../../lib/permission-suggestions'
import { resolvePlanDialogKey } from '../../lib/plan-dialog-keys'
import type { PendingPermission } from '../../lib/session-reducer'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { MarkdownText } from './markdown'
import { optionDetail, optionLabel } from './permission-option-labels'

import styles from './exit-plan-mode-card.module.css'

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
  const dialogRef = useRef<HTMLDivElement>(null)
  const denyRef = useRef<HTMLTextAreaElement>(null)

  // Opening the rejection form (button or the D shortcut) should let the user
  // type the reason straight away.
  useEffect(() => {
    if (denyOpen) denyRef.current?.focus()
  }, [denyOpen])

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

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null
    const tag = target?.tagName
    const action = resolvePlanDialogKey({
      key: event.key,
      denyOpen,
      inEditable: tag === 'TEXTAREA' || tag === 'INPUT' || target?.isContentEditable === true,
      onButton: tag === 'BUTTON' || target?.getAttribute('role') === 'button',
      isComposing: event.nativeEvent.isComposing,
      hasModifier: event.metaKey || event.ctrlKey || event.altKey,
    })
    if (!action) return

    // stopPropagation keeps Radix's document-level Escape handler from closing
    // the dialog while it is only cancelling the rejection form.
    event.preventDefault()
    event.stopPropagation()
    if (action === 'approve') approve(false)
    else if (action === 'deny') setDenyOpen(true)
    else {
      setDenyOpen(false)
      setFeedback('')
    }
  }

  const promptsSection =
    allowedPrompts.length > 0 ? (
      <div className={styles.prompts}>
        <div className={styles.promptsLabel}>{t('allowedPrompts')}</div>
        <div className={styles.promptList}>
          {allowedPrompts.map((prompt, index) => (
            <span key={`${prompt.tool}-${index}`} className={styles.promptChip}>
              {prompt.tool ? <span className={styles.promptTool}>{prompt.tool}</span> : null}
              {prompt.tool && prompt.prompt ? ' · ' : null}
              {prompt.prompt}
            </span>
          ))}
        </div>
      </div>
    ) : null

  const extraOptionsSection =
    extraOptions.length > 0 ? (
      <div className={styles.extraOptions}>
        {extraOptions.map((option) => {
          const detail = optionDetail(option)
          return (
            <Button
              key={option.id}
              type="button"
              variant="surface"
              className={styles.optionButton}
              onClick={() => applyOption(option)}
            >
              <span>{optionLabel(option, tChat)}</span>
              {detail ? <span className={styles.detail}>{detail}</span> : null}
            </Button>
          )
        })}
      </div>
    ) : null

  const actions = denyOpen ? (
    <div className={styles.denyForm}>
      <textarea
        ref={denyRef}
        className={styles.denyInput}
        rows={2}
        placeholder={t('denyPlaceholder')}
        aria-label={t('deny')}
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
      />
      <div className={styles.denyButtons}>
        <Button type="button" variant="surface" className={styles.denySendButton} onClick={submitDeny}>
          <X className={styles.icon} />
          {t('sendDeny')}
        </Button>
        <Button
          type="button"
          variant="surface"
          className={styles.cancelButton}
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
    <div className={styles.actions}>
      <Button type="button" variant="brand" className={styles.actionButton} onClick={() => approve(false)}>
        <Check className={styles.icon} />
        {t('approve')}
      </Button>
      <Button type="button" variant="surface" className={styles.actionButton} onClick={() => approve(true)}>
        {t('approveAutoAccept')}
      </Button>
      <Button type="button" variant="surface" className={styles.denyActionButton} onClick={() => setDenyOpen(true)}>
        <X className={styles.icon} />
        {t('deny')}
      </Button>
    </div>
  )

  return (
    <>
      <div data-testid="exit-plan-mode-card" className={styles.card}>
        <div className={styles.header}>
          <ClipboardCheck className={styles.headerIcon} aria-hidden="true" />
          <span className={styles.title}>{t('title')}</span>
          {plan ? (
            <Button
              type="button"
              variant="surface"
              data-testid="exit-plan-view"
              className={styles.viewButton}
              onClick={() => setDialogOpen(true)}
            >
              <Maximize2 className={styles.icon} />
              {t('viewPlan')}
            </Button>
          ) : null}
        </div>

        {plan ? <p className={styles.preview}>{preview}</p> : <p className={styles.missing}>{t('missingPlan')}</p>}

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
            ref={dialogRef}
            data-testid="exit-plan-mode-dialog"
            tabIndex={-1}
            // Focus the container instead of the first button so A/D/Enter stay
            // shortcuts rather than button activations.
            initialFocus={() => dialogRef.current}
            onKeyDown={handleDialogKeyDown}
            className={styles.dialog}
          >
            <DialogHeader>
              <DialogTitle className={styles.dialogTitle}>{t('title')}</DialogTitle>
              <DialogDescription className={styles.dialogDescription}>{t('dialogDescription')}</DialogDescription>
            </DialogHeader>

            <div className={styles.dialogBody}>
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
