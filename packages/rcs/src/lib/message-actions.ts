import { assistantCopyText } from './copy-text'
import type { CursorItem } from './message-cursor'
import type { ThreadEntry, ToolCallEntry } from './session-reducer'

/**
 * Text of the most recent prompt in the thread. Feeds the composer's "edit"
 * action and the reply's "regenerate" action; both resend it as a new turn
 * because the bridge cannot rewind the CLI's conversation.
 */
export function latestPrompt(entries: ThreadEntry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.type === 'user_message' && entry.content.trim()) return entry.content
  }
  return null
}

export interface PrimaryInputField {
  label: 'path' | 'command' | 'pattern' | 'url' | 'query' | 'prompt'
  value: string
}

function stringField(name: string) {
  return (input: Record<string, unknown>) => (typeof input[name] === 'string' ? input[name] : undefined)
}

/** The TUI's PRIMARY_INPUT table: the one argument `p` copies per tool. */
const PRIMARY_INPUT: Record<
  string,
  { label: PrimaryInputField['label']; extract: (input: Record<string, unknown>) => string | undefined }
> = {
  Read: { label: 'path', extract: stringField('file_path') },
  Edit: { label: 'path', extract: stringField('file_path') },
  Write: { label: 'path', extract: stringField('file_path') },
  NotebookEdit: { label: 'path', extract: stringField('notebook_path') },
  Bash: { label: 'command', extract: stringField('command') },
  Grep: { label: 'pattern', extract: stringField('pattern') },
  Glob: { label: 'pattern', extract: stringField('pattern') },
  WebFetch: { label: 'url', extract: stringField('url') },
  WebSearch: { label: 'query', extract: stringField('query') },
  Task: { label: 'prompt', extract: stringField('prompt') },
  Agent: { label: 'prompt', extract: stringField('prompt') },
  Tmux: {
    label: 'command',
    extract: (input) => (Array.isArray(input.args) ? `tmux ${input.args.join(' ')}` : undefined),
  },
}

export function primaryInputOf(toolName: string, input?: Record<string, unknown>): PrimaryInputField | null {
  const entry = PRIMARY_INPUT[toolName]
  if (!entry || !input) return null
  const value = entry.extract(input)
  return value ? { label: entry.label, value } : null
}

/** Text projection of a tool result's `rawOutput.output` field. */
function outputTextOf(rawOutput?: Record<string, unknown>): string {
  if (!rawOutput) return ''
  const output = rawOutput.output
  if (typeof output === 'string') return output.trim()
  if (Array.isArray(output)) {
    return output
      .map((block) =>
        block && typeof block === 'object' && typeof (block as Record<string, unknown>).text === 'string'
          ? ((block as Record<string, unknown>).text as string)
          : '',
      )
      .join('')
      .trim()
  }
  if (output && typeof output === 'object') {
    const record = output as Record<string, unknown>
    if (typeof record.text === 'string') return record.text.trim()
    if (typeof record.content === 'string') return record.content.trim()
  }
  return ''
}

/** `c` on a selected entry. */
export function copyTextForEntry(entry: ThreadEntry): string {
  switch (entry.type) {
    case 'user_message':
      return entry.content
    case 'assistant_message':
      return assistantCopyText(entry.chunks)
    case 'plan':
      return entry.entries.map((item) => item.content).join('\n')
    case 'system':
      return entry.content ?? entry.subtype
    case 'tool_call': {
      const output = outputTextOf(entry.toolCall.rawOutput)
      return output || (primaryInputOf(entry.toolCall.title, entry.toolCall.rawInput)?.value ?? '')
    }
    case 'turn_end':
      return ''
  }
}

/**
 * `c` on a grouped tool run: the settled outputs, falling back to the newest
 * extractable primary input when nothing has completed.
 */
export function toolGroupCopyText(entries: ToolCallEntry[]): string {
  const outputs = entries.map((entry) => outputTextOf(entry.toolCall.rawOutput)).filter(Boolean)
  if (outputs.length > 0) return outputs.join('\n\n')
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (!entry) continue
    const primary = primaryInputOf(entry.toolCall.title, entry.toolCall.rawInput)
    if (primary) return primary.value
  }
  return ''
}

/** Enter while the cursor is on an item. */
export function cursorEnterAction(item: CursorItem): 'edit' | 'toggle' | null {
  if (item.kind === 'user') return 'edit'
  if (item.kind === 'tools') return 'toggle'
  return null
}
