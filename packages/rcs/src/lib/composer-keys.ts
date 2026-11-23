/**
 * Keyboard policy for the chat composer, extracted so it is testable without a DOM.
 *
 * Enter 发送：运行中默认插话（CLI 在下一个工具结果后注入）。Cmd/Ctrl+Enter
 * 改为排队到本轮结束再发。Escape 在 agent 运行时中断。
 */

export type ComposerKeyAction = 'submit' | 'submit-queued' | 'interrupt' | 'newline' | 'ignore'

export interface ComposerKeyInput {
  key: string
  shiftKey: boolean
  /** Cmd（macOS）或 Ctrl——把消息排队到本轮结束而不是插话。 */
  queueModifier: boolean
  /** IME composition in progress; the key belongs to the input method, not the composer. */
  isComposing: boolean
  isLoading: boolean
}

export function resolveComposerKey({
  key,
  shiftKey,
  queueModifier,
  isComposing,
  isLoading,
}: ComposerKeyInput): ComposerKeyAction {
  if (isComposing) return 'ignore'
  if (key === 'Enter') {
    if (shiftKey) return 'newline'
    return queueModifier ? 'submit-queued' : 'submit'
  }
  if (key === 'Escape' && isLoading) return 'interrupt'
  return 'ignore'
}

export interface SteerAllChordInput {
  key: string
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  /** 输入框有草稿或已挂附件时，Cmd/Ctrl+Enter 仍是“排队发送”。 */
  hasDraft: boolean
  /** 只有存在排队消息且一轮进行中时调用方才启用。 */
  enabled: boolean
}

/**
 * 空草稿的 Cmd/Ctrl+Enter 是“立即插话全部排队消息”。它与 P1 的
 * “有草稿 = 排队到本轮结束”共用组合键，靠草稿是否为空区分。
 */
export function isSteerAllChord({
  key,
  shiftKey,
  altKey,
  metaKey,
  ctrlKey,
  hasDraft,
  enabled,
}: SteerAllChordInput): boolean {
  if (!enabled || hasDraft) return false
  return key === 'Enter' && !shiftKey && !altKey && (metaKey || ctrlKey)
}

export type EditKeyAction = 'submit' | 'cancel' | 'newline' | 'ignore'

export interface EditKeyInput {
  key: string
  shiftKey: boolean
  /** IME composition in progress; the key belongs to the input method. */
  isComposing: boolean
}

/** Keyboard policy for the in-bubble message editor. */
export function resolveEditKey({ key, shiftKey, isComposing }: EditKeyInput): EditKeyAction {
  if (isComposing) return 'ignore'
  if (key === 'Enter') return shiftKey ? 'newline' : 'submit'
  if (key === 'Escape') return 'cancel'
  return 'ignore'
}
