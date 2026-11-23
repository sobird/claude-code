import type { ToolCallData } from '@/lib/session-reducer'

import { formatOutput } from './format'

/** CLI 在失败输出末尾单独追加一行 `Exit code N`。 */
const EXIT_CODE_LINE = /^Exit code (\d+)$/m

export interface BashViewModel {
  command: string
  description: string
  output: string
  errored: boolean
  /** 从失败输出里解析出的退出码；无则 `null`。 */
  exitCode: number | null
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
  }
}

function parseExitCode(output: string): number | null {
  const match = EXIT_CODE_LINE.exec(output)
  return match?.[1] === undefined ? null : Number(match[1])
}
