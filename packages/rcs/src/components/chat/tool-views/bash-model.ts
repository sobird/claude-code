import type { ToolCallData } from '@/lib/session-reducer'

import { formatOutput } from './format'

/** CLI 在失败输出末尾单独追加一行 `Exit code N`。 */
const EXIT_CODE_LINE = /^Exit code (\d+)$/m
/** 后台运行时 CLI 在结果里追加的说明行（用户指定或自动转入后台）。 */
const BACKGROUND_LINE =
  /^Command (?:running in background|was manually backgrounded by user|exceeded the assistant-mode blocking budget)[^\n]*$/m
/** 超时被杀时 CLI 会在 stderr 前补上一行说明。 */
const TIMEOUT_LINE = /^Command timed out after (.+)$/m

export interface BashViewModel {
  command: string
  description: string
  output: string
  errored: boolean
  /** 从失败输出里解析出的退出码；无则 `null`。 */
  exitCode: number | null
  /** 命令在后台运行（`run_in_background` 或 CLI 自动转入后台）。 */
  background: boolean
  /** 超时时长文本（如 `2s`）；未超时则 `null`。 */
  timeout: string | null
}

/** 提取 Bash 卡片所需的命令与输出；缺少命令时返回 `null` 以便回退到通用正文。 */
export function bashViewModel(tool: ToolCallData): BashViewModel | null {
  const input = tool.rawInput ?? {}
  const command = typeof input.command === 'string' ? input.command : ''
  if (!command.trim()) return null
  const output = formatOutput(tool)
  const exitCode = parseExitCode(output)
  return {
    command,
    description: typeof input.description === 'string' ? input.description : '',
    output,
    errored: tool.status === 'error' || exitCode !== null,
    exitCode,
    background: input.run_in_background === true || BACKGROUND_LINE.test(output),
    timeout: TIMEOUT_LINE.exec(output)?.[1] ?? null,
  }
}

function parseExitCode(output: string): number | null {
  const match = EXIT_CODE_LINE.exec(output)
  return match?.[1] === undefined ? null : Number(match[1])
}
