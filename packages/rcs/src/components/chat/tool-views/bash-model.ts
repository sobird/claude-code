import type { ToolCallData } from '@/lib/session-reducer'

import { formatOutput } from './format'

export interface BashViewModel {
  command: string
  description: string
  output: string
  errored: boolean
}

/** 提取 Bash 卡片所需的命令与输出；缺少命令时返回 `null` 以便回退到通用正文。 */
export function bashViewModel(tool: ToolCallData): BashViewModel | null {
  const input = tool.rawInput ?? {}
  const command = typeof input.command === 'string' ? input.command : ''
  if (!command.trim()) return null
  return {
    command,
    description: typeof input.description === 'string' ? input.description : '',
    output: formatOutput(tool),
    errored: tool.status === 'error',
  }
}
