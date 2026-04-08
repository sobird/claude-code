/**
 * Global declarations for compile-time macros and internal-only identifiers
 * that are eliminated via Bun's MACRO/bundle feature system.
 */

// ============================================================================
// MACRO — Bun compile-time macro function (from bun:bundle)
// Expands the function body at build time and removes the call in production.
// Also supports property access like MACRO.VERSION (compile-time constants).
declare namespace MACRO {
  export const VERSION: string
  export const BUILD_TIME: string
  export const FEEDBACK_CHANNEL: string
  export const ISSUES_EXPLAINER: string
  export const NATIVE_PACKAGE_URL: string
  export const PACKAGE_URL: string
  export const VERSION_CHANGELOG: string
  export const USER_TYPE: string
}
declare function MACRO<T>(fn: () => T): T

// Companion/buddy observer (internal)
declare function fireCompanionObserver(
  messages: unknown[],
  callback: (reaction: unknown) => void,
): void

// Ultraplan (internal)
declare function UltraplanChoiceDialog(props: Record<string, unknown>): JSX.Element | null
declare function UltraplanLaunchDialog(props: Record<string, unknown>): JSX.Element | null
// declare function launchUltraplan(...args: unknown[]): Promise<string>

// ============================================================================
// Bun text/file loaders — allow importing non-TS assets as strings
declare module '*.md' {
  const content: string
  export default content
}
declare module '*.txt' {
  const content: string
  export default content
}
declare module '*.html' {
  const content: string
  export default content
}
declare module '*.css' {
  const content: string
  export default content
}

declare namespace NodeJS {
  interface ProcessEnv {
    AUDIO_CAPTURE_NODE_PATH?: string;
    CLAUDE_CODE_TASK_LIST_ID: string;
    USER_TYPE?: string;
    CLAUDE_CODE_PERFETTO_TRACE?: string;
    OTEL_LOG_TOOL_CONTENT?: string;
  }
}