'use client'

/**
 * Chat composer with Enter-to-send and Shift+Enter newline. Enabled input
 * becomes an interrupt control while the agent is busy.
 */

import { Send, Square } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import { cn } from '../../lib/utils'

interface ChatInputProps {
  onSubmit: (text: string) => void
  onInterrupt?: () => void
  isLoading?: boolean
  disabled?: boolean
  placeholder?: string
  className?: string
}

export function ChatInput({
  onSubmit,
  onInterrupt,
  isLoading = false,
  disabled = false,
  placeholder = '给 Claude 发送消息…',
  className,
}: ChatInputProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSubmit(trimmed)
    setText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [text, disabled, onSubmit])

  const handleInput = useCallback((target: HTMLTextAreaElement) => {
    setText(target.value)
    target.style.height = 'auto'
    target.style.height = `${Math.min(target.scrollHeight, 200)}px`
  }, [])

  const canSend = text.trim().length > 0 && !disabled

  return (
    <div className={cn('mx-auto w-full max-w-3xl', className)}>
      <div className="overflow-hidden rounded-xl border border-border bg-surface-2 transition-all focus-within:border-brand/50 focus-within:shadow-[0_0_0_3px_rgba(201,100,66,0.15)]">
        <div className="flex items-end gap-2 px-3 py-2.5">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => handleInput(event.target)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                if (isLoading) onInterrupt?.()
                else handleSubmit()
              }
            }}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="max-h-[200px] min-h-[24px] flex-1 resize-none border-none bg-transparent font-display text-sm leading-normal text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="button"
            onClick={isLoading ? onInterrupt : handleSubmit}
            disabled={!isLoading && !canSend}
            aria-label={isLoading ? '中断' : '发送'}
            className={cn(
              'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-all sm:h-8 sm:w-8',
              isLoading
                ? 'bg-text-primary text-surface-2 hover:bg-text-secondary'
                : canSend
                  ? 'bg-brand text-white hover:bg-brand-light hover:scale-[1.05] active:scale-[0.97]'
                  : 'bg-surface-1 text-text-muted',
            )}
          >
            {isLoading ? <Square className="h-3.5 w-3.5" fill="currentColor" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div className="mt-1.5 text-center">
        <span className="font-display text-[11px] text-text-muted">Enter 发送，Shift+Enter 换行</span>
      </div>
    </div>
  )
}
