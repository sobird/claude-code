/**
 * Identifies which code path issued a model request. Surfaced on
 * `betaHeaders`/analytics and used by retry policy (`withRetry`), cache TTL
 * selection, and compaction guards. The `repl_main_thread` and `agent:` prefix
 * families are matched with `startsWith` (see `services/api/claude.ts` and
 * `services/compact/microCompact.ts`), so new members must keep those prefixes.
 */
export type QuerySource =
  // Main REPL thread, optionally tagged with the active output style.
  | 'repl_main_thread'
  | `repl_main_thread:outputStyle:${string}`
  // Subagents: built-in types carry a suffix, custom agents are one tag.
  | 'agent:custom'
  | 'agent:default'
  | 'agent:builtin'
  | `agent:builtin:${string}`
  // Foreground work (retries on 529 — see FOREGROUND_529_RETRY_SOURCES).
  | 'sdk'
  | 'compact'
  | 'hook_agent'
  | 'hook_prompt'
  | 'verification_agent'
  | 'side_question'
  | 'auto_mode'
  | 'bash_classifier'
  // Background work: summaries, titles, suggestions, classifiers.
  | 'agent_creation'
  | 'agent_summary'
  | 'auto_dream'
  | 'auto_mode_critique'
  | 'away_summary'
  | 'bash_extract_prefix'
  | 'buddy_companion'
  | 'chrome_mcp'
  | 'extract_memories'
  | 'feedback'
  | 'generate_session_title'
  | 'insights'
  | 'magic_docs'
  | 'marble_origami'
  | 'mcp_datetime_parse'
  | 'memdir_relevance'
  | 'model_validation'
  | 'permission_explainer'
  | 'prompt_suggestion'
  | 'rename_generate_name'
  | 'session_memory'
  | 'session_search'
  | 'skill_improvement'
  | 'skill_improvement_apply'
  | 'speculation'
  | 'teleport_generate_title'
  | 'tool_use_summary_generation'
  | 'web_fetch_apply'
  | 'web_search_tool'
