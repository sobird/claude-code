/**
 * ANT-ONLY CLI subcommand handlers (log, error, export, task, completion).
 * Extracted from main.tsx so they only load when the subcommand runs.
 */
/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handlers intentionally exit */

import { readFile, writeFile } from 'node:fs/promises'

import type { Command } from '@commander-js/extra-typings'

import type { Message } from '../../types/message.js'
import { errorMessage } from '../../utils/errors.js'
import { renderMessagesToPlainText } from '../../utils/exportRenderer.js'
import { getLogDisplayTitle, loadErrorLogs } from '../../utils/log.js'
import { loadMessageLogs } from '../../utils/sessionStorage.js'
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js'
import {
  createTask,
  DEFAULT_TASKS_MODE_TASK_LIST_ID,
  getTask,
  getTasksDir,
  listTasks,
  TASK_STATUSES,
  updateTask,
} from '../../utils/tasks.js'

const EXPORT_COLUMNS = 100

function resolveLogIndex(index: number, length: number): number | null {
  if (!Number.isInteger(index)) return null
  const resolved = index < 0 ? length + index : index
  return resolved >= 0 && resolved < length ? resolved : null
}

/**
 * `claude log [number|sessionId]` — list conversation logs, or render one to
 * stdout. A bare number indexes the sorted (newest-first) log list; a session
 * id matches `LogOption.sessionId`.
 */
export const logHandler = async (logId: string | number | undefined): Promise<void> => {
  const logs = await loadMessageLogs()
  if (logs.length === 0) {
    console.log('No conversation logs found.')
    return
  }

  if (logId === undefined) {
    console.log(`Conversation logs for this project (${logs.length}):`)
    logs.forEach((log, index) => {
      const id = log.sessionId ? ` ${log.sessionId.slice(0, 8)}` : ''
      console.log(`  ${index}: ${getLogDisplayTitle(log)}${id} (${log.messageCount} messages)`)
    })
    return
  }

  const log =
    typeof logId === 'number'
      ? (() => {
          const index = resolveLogIndex(logId, logs.length)
          return index === null ? undefined : logs[index]
        })()
      : logs.find((entry) => entry.sessionId === logId)

  if (!log) {
    console.error(`No conversation log found for ${String(logId)}.`)
    process.exitCode = 1
    return
  }

  console.log(`# ${getLogDisplayTitle(log)}`)
  console.log(await renderMessagesToPlainText(log.messages, [], EXPORT_COLUMNS))
}

/**
 * `claude error [number]` — list error logs, or render one to stdout. Without
 * an argument the most recent error log is shown.
 */
export const errorHandler = async (num: number | undefined): Promise<void> => {
  const logs = await loadErrorLogs()
  if (logs.length === 0) {
    console.log('No error logs found.')
    return
  }

  const index = resolveLogIndex(num ?? 0, logs.length)
  if (index === null) {
    console.error(`No error log at index ${String(num ?? 0)} (found ${logs.length}).`)
    process.exitCode = 1
    return
  }

  const log = logs[index]
  if (!log) {
    process.exitCode = 1
    return
  }

  console.log(`# ${getLogDisplayTitle(log)}`)
  console.log(await renderMessagesToPlainText(log.messages, [], EXPORT_COLUMNS))
}

/**
 * Parses a `.json` (array of messages) or `.jsonl` (one message per line)
 * conversation log. Non-message lines (session metadata entries) are skipped.
 */
async function readMessagesFromFile(path: string): Promise<Message[]> {
  const raw = await readFile(path, 'utf8')
  const parsed: unknown = path.endsWith('.jsonl')
    ? raw
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => {
          try {
            return jsonParse(line)
          } catch {
            return null
          }
        })
        .filter((entry) => entry !== null)
    : jsonParse(raw)

  if (!Array.isArray(parsed)) return []
  return parsed.filter(
    (entry): entry is Message =>
      typeof entry === 'object' && entry !== null && typeof (entry as { type?: unknown }).type === 'string',
  )
}

/**
 * `claude export <source> <outputFile>` — render a conversation to a plain
 * text file. `source` is a session id, a log index, or a path to a
 * `.json`/`.jsonl` log.
 */
export const exportHandler = async (source: string, outputFile: string): Promise<void> => {
  let messages: Message[] | undefined

  if (/\.(json|jsonl)$/i.test(source)) {
    try {
      messages = await readMessagesFromFile(source)
    } catch (error) {
      console.error(`Failed to read ${source}: ${errorMessage(error)}`)
      process.exitCode = 1
      return
    }
  } else {
    const logs = await loadMessageLogs()
    const asNumber = Number(source)
    const log = Number.isInteger(asNumber)
      ? (() => {
          const index = resolveLogIndex(asNumber, logs.length)
          return index === null ? undefined : logs[index]
        })()
      : logs.find((entry) => entry.sessionId === source)
    if (!log) {
      console.error(`No conversation log found for ${source}.`)
      process.exitCode = 1
      return
    }
    messages = log.messages
  }

  if (!messages || messages.length === 0) {
    console.error(`No messages found in ${source}.`)
    process.exitCode = 1
    return
  }

  const content = await renderMessagesToPlainText(messages, [], EXPORT_COLUMNS)
  try {
    await writeFile(outputFile, content, 'utf8')
  } catch (error) {
    console.error(`Failed to write ${outputFile}: ${errorMessage(error)}`)
    process.exitCode = 1
    return
  }
  console.log(`Conversation exported to: ${outputFile}`)
}

function resolveTaskListId(listId: string | undefined): string {
  return listId || DEFAULT_TASKS_MODE_TASK_LIST_ID
}

function formatTaskLine(task: { id: string; subject: string; status: string; owner?: string }): string {
  const owner = task.owner ? ` (${task.owner})` : ''
  return `  ${task.id}. [${task.status}] ${task.subject}${owner}`
}

/** `claude task create <subject>` */
export const taskCreateHandler = async (
  subject: string,
  opts: { description?: string; list?: string },
): Promise<void> => {
  const listId = resolveTaskListId(opts.list)
  const id = await createTask(listId, {
    subject,
    description: opts.description ?? '',
    status: 'pending',
    blocks: [],
    blockedBy: [],
  })
  console.log(`Created task ${id} in "${listId}".`)
}

/** `claude task list` */
export const taskListHandler = async (opts: { list?: string; pending?: boolean; json?: boolean }): Promise<void> => {
  const listId = resolveTaskListId(opts.list)
  const tasks = await listTasks(listId)
  const filtered = opts.pending ? tasks.filter((task) => task.status === 'pending') : tasks

  if (opts.json) {
    console.log(jsonStringify(filtered, null, 2))
    return
  }

  if (filtered.length === 0) {
    console.log(`No tasks in "${listId}".`)
    return
  }

  console.log(`Tasks in "${listId}" (${filtered.length}):`)
  for (const task of filtered) console.log(formatTaskLine(task))
}

/** `claude task get <id>` */
export const taskGetHandler = async (id: string, opts: { list?: string }): Promise<void> => {
  const task = await getTask(resolveTaskListId(opts.list), id)
  if (!task) {
    console.error(`Task ${id} not found.`)
    process.exitCode = 1
    return
  }
  console.log(jsonStringify(task, null, 2))
}

/** `claude task update <id>` */
export const taskUpdateHandler = async (
  id: string,
  opts: {
    list?: string
    status?: string
    subject?: string
    description?: string
    owner?: string
    clearOwner?: boolean
  },
): Promise<void> => {
  const updates: {
    status?: (typeof TASK_STATUSES)[number]
    subject?: string
    description?: string
    owner?: string
  } = {}

  if (opts.status !== undefined) {
    if (!(TASK_STATUSES as readonly string[]).includes(opts.status)) {
      console.error(`Invalid status "${opts.status}". Expected one of: ${TASK_STATUSES.join(', ')}.`)
      process.exitCode = 1
      return
    }
    updates.status = opts.status as (typeof TASK_STATUSES)[number]
  }
  if (opts.subject !== undefined) updates.subject = opts.subject
  if (opts.description !== undefined) updates.description = opts.description
  if (opts.owner !== undefined) updates.owner = opts.owner
  if (opts.clearOwner) updates.owner = undefined

  const task = await updateTask(resolveTaskListId(opts.list), id, updates)
  if (!task) {
    console.error(`Task ${id} not found.`)
    process.exitCode = 1
    return
  }
  console.log(`Updated task ${task.id}.`)
}

/** `claude task dir` */
export const taskDirHandler = async (opts: { list?: string }): Promise<void> => {
  console.log(getTasksDir(resolveTaskListId(opts.list)))
}

type HiddenCommand = { _hidden?: boolean }
type CompletionCommand = { name(): string; description(): string }

function visibleCommands(program: Command): CompletionCommand[] {
  return program.commands
    .filter((command) => !(command as unknown as HiddenCommand)._hidden)
    .map((command) => ({ name: () => command.name(), description: () => command.description() }))
}

function escapeZsh(text: string): string {
  return text.replace(/'/g, `'\\''`)
}

function buildBashCompletion(program: Command, names: string[]): string {
  const fn = `_${program.name()}_completions`
  return [
    `${fn}() {`,
    '  local cur="${COMP_WORDS[COMP_CWORD]}"',
    `  local commands="${names.join(' ')}"`,
    '  COMPREPLY=( $(compgen -W "$commands" -- "$cur") )',
    '}',
    `complete -F ${fn} ${program.name()}`,
    '',
  ].join('\n')
}

function buildZshCompletion(program: Command, commands: CompletionCommand[]): string {
  const fn = `_${program.name()}`
  const entries = commands
    .map((command) => `    '${escapeZsh(command.name())}:${escapeZsh(command.description())}'`)
    .join('\n')
  return [
    `#compdef ${program.name()}`,
    '',
    `${fn}() {`,
    '  local -a commands',
    '  commands=(',
    entries,
    '  )',
    "  _describe 'command' commands",
    '}',
    '',
    `${fn} "$@"`,
    '',
  ].join('\n')
}

function buildFishCompletion(program: Command, commands: CompletionCommand[]): string {
  const lines = [`complete -c ${program.name()} -f`]
  for (const command of commands) {
    lines.push(
      `complete -c ${program.name()} -n '__fish_use_subcommand' -a '${command.name()}' -d '${command
        .description()
        .replace(/'/g, "\\'")}'`,
    )
  }
  return `${lines.join('\n')}\n`
}

/**
 * `claude completion <bash|zsh|fish>` — emit a completion script built from
 * the top-level commands registered on the commander program.
 */
export const completionHandler = async (shell: string, opts: { output?: string }, program: Command): Promise<void> => {
  const commands = visibleCommands(program)
  const normalized = shell.toLowerCase()

  let script: string
  switch (normalized) {
    case 'bash':
      script = buildBashCompletion(
        program,
        commands.map((command) => command.name()),
      )
      break
    case 'zsh':
      script = buildZshCompletion(program, commands)
      break
    case 'fish':
      script = buildFishCompletion(program, commands)
      break
    default:
      console.error(`Unsupported shell "${shell}". Expected bash, zsh, or fish.`)
      process.exitCode = 1
      return
  }

  if (opts.output) {
    await writeFile(opts.output, script, 'utf8')
    console.log(`Wrote ${normalized} completion script to ${opts.output}`)
    return
  }

  process.stdout.write(script)
}
