import { randomUUID } from 'node:crypto'

import { useCallback, useEffect, useRef, useState } from 'react'
import { isFeedbackSurveyDisabled } from 'src/services/analytics/config.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'

import { isPolicyAllowed } from '../../services/policyLimits/index.js'
import type { Message, UserMessage } from '../../types/message.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getContentText } from '../../utils/messages.js'
import { matchesNegativeKeyword } from '../../utils/userPromptKeywords.js'
import { submitTranscriptShare } from './submitTranscriptShare.js'
import type { TranscriptShareResponse } from './TranscriptSharePrompt.js'

const FRUSTRATION_SURVEY_EVENT = 'tengu_frustration_survey_event'
// Same sampling rate as the memory survey — frustration keywords are rare,
// but the transcript prompt is disruptive enough to still sample.
const FRUSTRATION_PROBABILITY = 0.2
const SUBMITTED_DISPLAY_MS = 3000

type FrustrationState = 'closed' | 'transcript_prompt' | 'submitting' | 'submitted'

/**
 * Finds the latest human-authored user turn.
 *
 * Meta messages (system reminders) and transcript-only messages are synthetic,
 * and tool_result turns contain no text blocks so they can't match keywords.
 */
function getLastHumanUserMessage(messages: Message[]): UserMessage | undefined {
  return messages.findLast(
    (msg): msg is UserMessage => msg.type === 'user' && !msg.isMeta && !msg.isVisibleInTranscriptOnly,
  )
}

/**
 * Detects frustrated user input and offers to share the transcript.
 *
 * When the latest user turn matches a negative keyword ("wtf", "so
 * frustrating", …) we probabilistically show the transcript-sharing prompt
 * directly — there is no intermediate survey step, since the frustration
 * itself is the signal. Each user message is evaluated once per session.
 */
export function useFrustrationDetection(
  messages: Message[],
  isLoading: boolean,
  hasActivePrompt: boolean,
  otherSurveyOpen: boolean,
): {
  state: FrustrationState
  handleTranscriptSelect: (selected: TranscriptShareResponse) => void
} {
  const [state, setState] = useState<FrustrationState>('closed')
  // Evaluate each user message once — re-renders must not re-roll the
  // probability or re-scan the message list for the same turn.
  const seenUserUuids = useRef(new Set<string>())
  const appearanceId = useRef(randomUUID())
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const logFrustrationEvent = useCallback((eventType: string) => {
    logEvent(FRUSTRATION_SURVEY_EVENT, {
      event_type: eventType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      appearance_id: appearanceId.current as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }, [])

  const handleTranscriptSelect = useCallback(
    (selected: TranscriptShareResponse) => {
      logFrustrationEvent(`transcript_share_${selected}`)

      if (selected === 'dont_ask_again') {
        saveGlobalConfig((current) => ({
          ...current,
          transcriptShareDismissed: true,
        }))
      }

      if (selected !== 'yes') {
        setState('closed')
        return
      }

      setState('submitting')
      void (async () => {
        const result = await submitTranscriptShare(messagesRef.current, 'frustration', appearanceId.current)
        if (result.success) {
          setState('submitted')
          setTimeout(setState, SUBMITTED_DISPLAY_MS, 'closed')
        } else {
          setState('closed')
        }
      })()
    },
    [logFrustrationEvent],
  )

  useEffect(() => {
    // /clear resets messages but REPL stays mounted — drop prior evaluations.
    if (messages.length === 0) {
      seenUserUuids.current.clear()
      return
    }

    if (state !== 'closed' || isLoading || hasActivePrompt || otherSurveyOpen) {
      return
    }

    if (process.env.USER_TYPE !== 'ant') {
      return
    }

    if (isFeedbackSurveyDisabled()) {
      return
    }

    if (!isPolicyAllowed('allow_product_feedback')) {
      return
    }

    if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY)) {
      return
    }

    if (getGlobalConfig().transcriptShareDismissed) {
      return
    }

    const lastUser = getLastHumanUserMessage(messages)
    if (!lastUser || seenUserUuids.current.has(lastUser.uuid)) {
      return
    }

    // Mark as evaluated before the keyword check so an unfrustrated turn isn't
    // re-scanned on every subsequent render.
    seenUserUuids.current.add(lastUser.uuid)

    const text = getContentText(lastUser.message.content)
    if (!text || !matchesNegativeKeyword(text)) {
      return
    }

    if (Math.random() < FRUSTRATION_PROBABILITY) {
      appearanceId.current = randomUUID()
      logFrustrationEvent('appeared')
      setState('transcript_prompt')
    }
  }, [state, isLoading, hasActivePrompt, otherSurveyOpen, messages, logFrustrationEvent])

  return { state, handleTranscriptSelect }
}
