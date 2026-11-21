'use client'

/**
 * Progressive reveal for streamed assistant text.
 *
 * The reducer appends deltas as they arrive, which the bridge batches (~100ms),
 * so rendering the raw text reads as jumps. This hook holds a fractional reveal
 * position and advances it every animation frame toward the newest text length
 * (paced by `advanceReveal`), producing a continuous typewriter effect that
 * stays close behind generation. Text that shrinks or a reduced-motion
 * preference snaps to the full value.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { advanceReveal } from '@/lib/smooth-text'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function useSmoothText(text: string): string {
  // Split by code point so a surrogate pair (emoji) never renders half a glyph.
  const chars = useMemo(() => Array.from(text), [text])
  const [shown, setShown] = useState(0)
  const positionRef = useRef(0)
  const targetRef = useRef(chars.length)
  targetRef.current = chars.length

  useEffect(() => {
    if (positionRef.current >= targetRef.current || prefersReducedMotion()) {
      positionRef.current = targetRef.current
      setShown(targetRef.current)
      return undefined
    }

    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      positionRef.current = advanceReveal(positionRef.current, targetRef.current, now - last)
      last = now
      setShown(Math.ceil(positionRef.current))
      if (positionRef.current < targetRef.current) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [chars.length])

  return useMemo(() => chars.slice(0, shown).join(''), [chars, shown])
}
