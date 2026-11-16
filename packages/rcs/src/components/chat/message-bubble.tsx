'use client'

/**
 * Conversation bubbles. Ported from the legacy Vite UI and adapted to the
 * reducer's `UserMessageEntry` / `AssistantMessageEntry` model.
 */

import { ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { AssistantMessageEntry, UserMessageEntry } from '../../lib/session-reducer'
import { cn } from '../../lib/utils'

// Collapsed user-message height (px) before the "expand" affordance appears.
const COLLAPSED_MAX_HEIGHT = 200

/** Right-aligned user message with brand-tinted bubble and collapse-on-overflow. */
export function UserBubble({ entry }: { entry: UserMessageEntry }) {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const checkOverflow = useCallback(() => {
    const el = contentRef.current
    if (!el) return
    setOverflowing(el.scrollHeight > COLLAPSED_MAX_HEIGHT + 4)
  }, [])

  useEffect(() => {
    checkOverflow()
  }, [checkOverflow, entry.content])

  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] sm:max-w-[70%]">
        {entry.content ? (
          <div className="relative overflow-hidden rounded-2xl rounded-br-md border border-user-bubble-border bg-user-bubble">
            <div
              ref={contentRef}
              className={cn(
                'whitespace-pre-wrap px-4 py-3 font-display text-sm leading-relaxed text-white',
                !expanded && overflowing && 'overflow-hidden',
              )}
              style={!expanded && overflowing ? { maxHeight: `${COLLAPSED_MAX_HEIGHT}px` } : undefined}
            >
              {entry.content}
            </div>
            {!expanded && overflowing ? (
              <div className="absolute inset-x-0 bottom-0 flex flex-col items-center bg-gradient-to-t from-user-bubble via-user-bubble/80 to-transparent pt-8">
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="flex items-center gap-1 rounded-full px-3 py-1 font-display text-xs font-medium text-white/90 transition-colors hover:bg-white/15"
                >
                  <span>展开</span>
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Left-aligned assistant message with the Anthropic mark and editable prose. */
export function AssistantBubble({ entry }: { entry: AssistantMessageEntry }) {
  return (
    <div className="flex items-start gap-3 sm:gap-4">
      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand/10">
        <ClaudeMark />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <span className="font-display text-sm font-semibold text-text-primary">Claude</span>
        {entry.chunks.map((chunk) =>
          chunk.type === 'thought' ? (
            <ThoughtBlock key={`thought-${chunk.text}`} text={chunk.text} />
          ) : (
            <div
              key={`message-${chunk.text}`}
              className="whitespace-pre-wrap break-words font-sans text-sm leading-[1.75] text-text-primary"
              style={{ overflowWrap: 'anywhere' }}
            >
              {chunk.text}
            </div>
          ),
        )}
      </div>
    </div>
  )
}

function ThoughtBlock({ text }: { text: string }) {
  return (
    <details className="group rounded-lg border border-border bg-surface-1/60 px-3 py-2">
      <summary className="cursor-pointer list-none font-display text-xs font-medium text-text-muted transition-colors hover:text-text-secondary">
        <span className="inline-flex items-center gap-1.5">
          <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
          思考过程
        </span>
      </summary>
      <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-text-secondary">{text}</div>
    </details>
  )
}

function ClaudeMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"
        fill="var(--color-brand)"
        fillRule="nonzero"
      />
    </svg>
  )
}
