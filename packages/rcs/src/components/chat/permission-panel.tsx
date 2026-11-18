'use client'

/**
 * Pending permission cards, pinned above the chat input. Buttons are
 * thumb-friendly on mobile (full-width, 44px targets) and compact on desktop.
 *
 * Each card offers allow-once plus whatever the CLI suggested
 * (`permission_suggestions`): "allow for session", "always allow", directory
 * grants, auto-accept edits. Denying can attach a message the CLI passes back
 * to the model.
 */

import { Check, Pencil, ShieldAlert, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'

import { isAskUserQuestionRequest } from '../../lib/ask-user-question'
import { resolvePermissionKey } from '../../lib/permission-keys'
import {
  editableRule,
  permissionOptions,
  withRuleContent,
  type PermissionDecision,
  type PermissionOption,
  type PermissionSuggestion,
} from '../../lib/permission-suggestions'
import type { PendingPermission } from '../../lib/session-reducer'
import { diffLines, toolEditPreview } from '../../lib/text-diff'
import { cx } from '../../lib/utils'
import { Button } from '../ui/button'
import { AskUserQuestionCard } from './ask-user-question-card'
import { ExitPlanModeCard, isExitPlanModeRequest } from './exit-plan-mode-card'
import { optionDetail, optionLabel } from './permission-option-labels'

import styles from './permission-panel.module.css'

interface PermissionPanelProps {
  requests: PendingPermission[]
  onRespond?: (requestId: string, decision: PermissionDecision) => void
  className?: string
}

export function PermissionPanel({ requests, onRespond, className }: PermissionPanelProps) {
  const [selected, setSelected] = useState(0)
  // AskUserQuestion prompts are answered in their own card, so keyboard
  // approval shortcuts only navigate the plain allow/deny cards.
  const respondable = useMemo(
    () =>
      requests.filter(
        (request) =>
          !isAskUserQuestionRequest(request.toolName, request.toolInput) && !isExitPlanModeRequest(request.toolName),
      ),
    [requests],
  )
  // Clamp instead of syncing state so a shrinking request list never selects
  // an index that no longer exists.
  const activeIndex = Math.min(selected, Math.max(respondable.length - 1, 0))

  // Keyboard-only approvals: a document listener covers the case where focus is
  // still on the composer or elsewhere. Editable elements keep their keys.
  useEffect(() => {
    if (respondable.length === 0) return undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      const inEditable = Boolean(
        target?.closest('textarea, input, select, button, a[href], summary, [role="button"], [contenteditable="true"]'),
      )
      const action = resolvePermissionKey({
        key: event.key,
        requestCount: respondable.length,
        selectedIndex: activeIndex,
        inEditable,
        isComposing: event.isComposing,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      })
      if (action.action === 'ignore') return
      event.preventDefault()

      switch (action.action) {
        case 'allow':
        case 'deny': {
          const request = respondable[action.index]
          if (request) onRespond?.(request.requestId, { approved: action.action === 'allow' })
          return
        }
        case 'select':
          setSelected(action.index)
          return
        case 'next':
          setSelected(Math.min(activeIndex + 1, respondable.length - 1))
          return
        case 'previous':
          setSelected(Math.max(activeIndex - 1, 0))
          return
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [activeIndex, onRespond, respondable])

  if (requests.length === 0) return null

  const activeRequestId = respondable[activeIndex]?.requestId
  // Only the newest plan request auto-opens its dialog; older queued ones stay
  // behind the inline card so overlays never stack.
  const exitPlanRequests = requests.filter((request) => isExitPlanModeRequest(request.toolName))
  const autoOpenExitPlanId = exitPlanRequests[exitPlanRequests.length - 1]?.requestId

  return (
    <div className={cx(styles.panel, className)}>
      <div className={styles.list}>
        {requests.map((request) =>
          isAskUserQuestionRequest(request.toolName, request.toolInput) ? (
            <AskUserQuestionCard key={request.requestId} request={request} onRespond={onRespond} />
          ) : isExitPlanModeRequest(request.toolName) ? (
            <ExitPlanModeCard
              key={request.requestId}
              request={request}
              onRespond={onRespond}
              autoOpen={request.requestId === autoOpenExitPlanId}
            />
          ) : (
            <PermissionCard
              key={request.requestId}
              request={request}
              selected={request.requestId === activeRequestId}
              onRespond={onRespond}
            />
          ),
        )}
      </div>
    </div>
  )
}

function PermissionCard({
  request,
  selected,
  onRespond,
}: {
  request: PendingPermission
  selected?: boolean
  onRespond?: (requestId: string, decision: PermissionDecision) => void
}) {
  const t = useTranslations('chat')
  const tc = useTranslations('common')
  const [denyOpen, setDenyOpen] = useState(false)
  const [feedback, setFeedback] = useState('')
  // Inline editor for the single allow rule an `addRules` suggestion carries.
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null)
  const [ruleDraft, setRuleDraft] = useState('')

  const options = useMemo(() => permissionOptions(request.suggestions), [request.suggestions])
  const allowOnce = options[0] ?? { id: 'allow-once', kind: 'allow-once' as const, suggestionIndex: null }
  // The CLI's deny result schema has no updatedPermissions, so a deny-rule
  // suggestion cannot be persisted from here; only allow-oriented ones show.
  const extraOptions = options.filter((option) => option.kind !== 'allow-once' && option.kind !== 'always-deny')
  const hunks = useMemo(() => toolEditPreview(request.toolInput), [request.toolInput])
  const inputPreview = formatInput(request.toolInput)

  const suggestionFor = (option: PermissionOption): PermissionSuggestion | undefined =>
    option.suggestionIndex !== null ? request.suggestions[option.suggestionIndex] : undefined

  const applyOption = (option: PermissionOption) => {
    const suggestion = suggestionFor(option)
    onRespond?.(request.requestId, {
      approved: true,
      ...(suggestion ? { updatedPermissions: [suggestion] } : {}),
    })
  }

  // Apply the suggestion with the rule's content swapped for the draft: the
  // user can turn `Bash` into `Bash(npm test:*)` before "always allowing".
  const applyEditedRule = (option: PermissionOption) => {
    const suggestion = suggestionFor(option)
    if (!suggestion) return
    onRespond?.(request.requestId, { approved: true, updatedPermissions: [withRuleContent(suggestion, ruleDraft)] })
  }

  const submitDeny = () => {
    const message = feedback.trim()
    onRespond?.(request.requestId, { approved: false, ...(message ? { message } : {}) })
  }

  return (
    <div aria-current={selected ? 'true' : undefined} className={cx(styles.card, selected && styles.cardSelected)}>
      <div className={styles.topRow}>
        <ShieldAlert className={styles.shield} aria-hidden="true" />
        <div className={styles.body}>
          <div className={styles.toolName}>{request.toolName || t('toolFallback')}</div>
          {request.description ? <div className={styles.description}>{request.description}</div> : null}
          {request.blockedPath ? (
            <div className={styles.blockedPath}>{t('permission.blockedPath', { path: request.blockedPath })}</div>
          ) : null}
          {request.decisionReason ? (
            <div className={styles.reason}>
              {t('permission.reason')}: {request.decisionReason}
            </div>
          ) : null}
          {hunks ? (
            <div className={styles.hunks}>
              {hunks.map((hunk, index) => (
                <div key={index} className={styles.hunk}>
                  {hunk.isNewFile ? <div className={styles.newFile}>+</div> : null}
                  <pre className={styles.diff}>
                    {diffLines(hunk.before, hunk.after).map((line, lineIndex) => (
                      <div
                        key={lineIndex}
                        className={cx(
                          styles.diffLine,
                          line.type === 'add' && styles.diffAdd,
                          line.type === 'remove' && styles.diffRemove,
                          line.type === 'context' && styles.diffContext,
                        )}
                      >
                        {line.type === 'add' ? '+ ' : line.type === 'remove' ? '- ' : '  '}
                        {line.text}
                      </div>
                    ))}
                  </pre>
                </div>
              ))}
            </div>
          ) : null}
          {inputPreview ? (
            <details className={styles.rawDetails} {...(hunks ? {} : { open: true })}>
              <summary className={styles.rawSummary}>{t('toolRawInput')}</summary>
              <pre className={styles.rawPre}>{inputPreview}</pre>
            </details>
          ) : null}
        </div>
      </div>

      {extraOptions.length > 0 ? (
        <div className={styles.options}>
          {extraOptions.map((option) => {
            const detail = optionDetail(option)
            const suggestion = suggestionFor(option)
            const rule = suggestion ? editableRule(suggestion) : null
            const editing = rule !== null && editingOptionId === option.id
            return (
              <div key={option.id} className={styles.optionGroup}>
                <div className={styles.optionRow}>
                  <Button
                    type="button"
                    variant="surface"
                    className={styles.optionButton}
                    onClick={() => applyOption(option)}
                  >
                    <span>{optionLabel(option, t)}</span>
                    {detail ? <span className={styles.detail}>{detail}</span> : null}
                  </Button>
                  {rule ? (
                    <Button
                      type="button"
                      variant="surface"
                      aria-label={t('permission.editRule')}
                      title={t('permission.editRule')}
                      data-testid="permission-edit-rule"
                      className={styles.editButton}
                      onClick={() => {
                        setRuleDraft(rule.ruleContent)
                        setEditingOptionId((prev) => (prev === option.id ? null : option.id))
                      }}
                    >
                      <Pencil className={styles.icon} />
                    </Button>
                  ) : null}
                </div>
                {editing && rule ? (
                  <div className={styles.ruleEditor}>
                    <span className={styles.ruleAffix}>{rule.toolName}(</span>
                    <input
                      data-testid="permission-rule-input"
                      aria-label={t('permission.editRule')}
                      placeholder={t('permission.rulePlaceholder')}
                      value={ruleDraft}
                      onChange={(event) => setRuleDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          applyEditedRule(option)
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          setEditingOptionId(null)
                        }
                      }}
                      className={styles.ruleInput}
                    />
                    <span className={styles.ruleAffix}>)</span>
                    <Button
                      type="button"
                      variant="brand"
                      className={styles.applyRuleButton}
                      onClick={() => applyEditedRule(option)}
                    >
                      {t('permission.applyRule')}
                    </Button>
                    <Button
                      type="button"
                      variant="surface"
                      className={styles.cancelRuleButton}
                      onClick={() => setEditingOptionId(null)}
                    >
                      {tc('cancel')}
                    </Button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {denyOpen ? (
        <div className={styles.denyForm}>
          <textarea
            className={styles.denyInput}
            rows={2}
            placeholder={t('permission.denyPlaceholder')}
            aria-label={t('permission.denyReason')}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
          />
          <div className={styles.denyButtons}>
            <Button type="button" variant="surface" className={styles.denySendButton} onClick={submitDeny}>
              <X className={styles.icon} />
              {t('permission.sendDeny')}
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
              {tc('cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          <Button
            type="button"
            variant="brand"
            aria-keyshortcuts="a"
            className={styles.actionButton}
            onClick={() => applyOption(allowOnce)}
          >
            <Check className={styles.icon} />
            {t('allow')}
            <ShortcutHint label="A" />
          </Button>
          <Button
            type="button"
            variant="surface"
            aria-keyshortcuts="d"
            className={styles.denyActionButton}
            onClick={() => setDenyOpen(true)}
          >
            <X className={styles.icon} />
            {t('deny')}
            <ShortcutHint label="D" />
          </Button>
        </div>
      )}
    </div>
  )
}

function ShortcutHint({ label }: { label: string }) {
  return <kbd className={styles.shortcutHint}>{label}</kbd>
}

function formatInput(input: Record<string, unknown>): string {
  if (!input || Object.keys(input).length === 0) return ''
  try {
    const json = JSON.stringify(input, null, 2)
    return json.length > 1200 ? `${json.slice(0, 1200)}...` : json
  } catch {
    return ''
  }
}
