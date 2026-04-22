/**
 * Keybinding types for Claude Code
 */

import { KEYBINDING_CONTEXTS, KEYBINDING_ACTIONS } from './schema.js'

/**
 * A parsed keystroke with modifier flags.
 *
 * Represents a single keystroke in a chord sequence (e.g., "ctrl+k" or just "k").
 * The alt and meta modifiers are equivalent in terminals - legacy terminal
 * behavior can't distinguish between Alt and Meta, so they're collapsed into
 * one logical modifier.
 */
export interface ParsedKeystroke {
  /** The base key name (e.g., 'k', 'enter', 'escape') */
  key: string

  /** Control modifier */
  ctrl: boolean

  /** Alt/Option modifier (equivalent to meta in terminals) */
  alt: boolean

  /** Shift modifier */
  shift: boolean

  /** Meta modifier (alias for alt in terminals) */
  meta: boolean

  /** Super/Cmd/Win modifier (only arrives via kitty keyboard protocol) */
  super: boolean
}

/**
 * A chord is an array of parsed keystrokes that form a complete binding.
 *
 * Examples:
 * - Single keystroke: [{key: 'k', ctrl: false, alt: false, shift: false, meta: false, super: false}]
 * - Chord: [{key: 'ctrl', ctrl: true, ...}, {key: 'k', ctrl: false, ...}]
 */
export type Chord = ParsedKeystroke[]

/**
 * A parsed binding from user configuration.
 *
 * Each binding represents a complete chord sequence mapped to an action,
 * scoped to a specific UI context.
 */
export interface ParsedBinding {
  /** The complete chord sequence for this binding */
  chord: Chord

  /** The action to execute when the chord is pressed */
  action: string | null // null means unbind

  /** The UI context where this binding applies */
  context: KeybindingContextName
}

/**
 * Valid keybinding context names where bindings can be applied.
 *
 * These correspond to different UI states/focus areas in the application.
 * Bindings are scoped to specific contexts to avoid conflicts.
 */
export type KeybindingContextName = (typeof KEYBINDING_CONTEXTS)[number]

/**
 * A block of keybindings for a specific context.
 *
 * This structure matches the JSON configuration format where each block
 * defines bindings for a particular UI context.
 */
export interface KeybindingBlock {
  /** The UI context for these bindings */
  context: KeybindingContextName

  /** Map of keystroke patterns to actions/commands/null */
  bindings: Record<string, string | null>
}

/**
 * Valid keybinding action identifiers.
 *
 * These map to actual functionality in the application. Actions starting
 * with prefixes like 'app:', 'chat:', etc. correspond to specific features.
 */
export type KeybindingAction = (typeof KEYBINDING_ACTIONS)[number]
