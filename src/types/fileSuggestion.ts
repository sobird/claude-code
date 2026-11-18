/**
 * JSON payload written to the `fileSuggestion` command's stdin.
 *
 * Mirrors `{ ...createBaseHookInput(), query }` in `hooks/fileSuggestions.ts`.
 */
export type FileSuggestionCommandInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
  query: string
}
