'use client'

/**
 * Markdown rendering for assistant text.
 *
 * Streamdown (with its shiki highlighter, KaTeX, and Mermaid) is loaded lazily
 * so none of it enters the initial bundle. The Suspense fallback is the same
 * pre-wrapped plain text the bubble rendered before, so a slow chunk never
 * leaves a blank line or jumps the layout.
 */

import { lazy, memo, Suspense, useEffect, useRef, useState } from 'react'

const LazyStreamdown = lazy(() => import('streamdown').then((module) => ({ default: module.Streamdown })))

interface MarkdownTextProps {
  text: string
  /** True while the chunk is still growing; keeps fence parsing lenient. */
  streaming?: boolean
}

export const MarkdownText = memo(
  function MarkdownText({ text, streaming = false }: MarkdownTextProps) {
    return (
      <Suspense fallback={<PlainText text={text} />}>
        <LazyStreamdown
          mode={streaming ? 'streaming' : 'static'}
          shikiTheme={['github-light', 'github-dark']}
          className="break-words font-sans text-sm leading-[1.75] text-text-primary [overflow-wrap:anywhere]"
        >
          {text}
        </LazyStreamdown>
      </Suspense>
    )
  },
  (prev, next) => prev.text === next.text && prev.streaming === next.streaming,
)

/**
 * Cap how often a fast-changing string reaches MarkdownText.
 *
 * The smooth reveal advances every animation frame; re-parsing markdown and
 * re-highlighting code at 60fps is wasteful. Batching to ~12fps keeps the
 * typewriter visually continuous (the floor rate is ~4 characters per tick)
 * while cutting the parse work by an order of magnitude.
 */
export function usePacedText(text: string, intervalMs: number): string {
  const [paced, setPaced] = useState(text)
  const lastRef = useRef(0)

  useEffect(() => {
    if (text === paced) return undefined
    const elapsed = performance.now() - lastRef.current
    if (elapsed >= intervalMs) {
      lastRef.current = performance.now()
      setPaced(text)
      return undefined
    }
    const timer = setTimeout(() => {
      lastRef.current = performance.now()
      setPaced(text)
    }, intervalMs - elapsed)
    return () => clearTimeout(timer)
  }, [text, paced, intervalMs])

  return paced
}

function PlainText({ text }: { text: string }) {
  return (
    <div
      className="whitespace-pre-wrap break-words font-sans text-sm leading-[1.75] text-text-primary"
      style={{ overflowWrap: 'anywhere' }}
    >
      {text}
    </div>
  )
}
