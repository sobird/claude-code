import { errorMessage, type RcsClient } from '@sobird/dsh-bridge/core'

import type { ResolvedConfig } from './config'
import type { SessionSupervisor } from './supervisor'
import { syncSession } from './sync'
import { isCommands, type CommandResultLike, type PluginContextLike } from './types'

/** `/rcs-max-sessions <n>`：运行时调上限；非法输入不改任何状态。 */
export async function runMaxSessionsCommand(
  supervisor: SessionSupervisor,
  rawInput: string,
): Promise<CommandResultLike> {
  const input = rawInput.trim()
  const limit = Number(input)
  if (!input || !Number.isInteger(limit) || limit <= 0) {
    return { kind: 'error', text: '用法：/rcs-max-sessions <正整数>' }
  }
  try {
    await supervisor.setMaxSessions(limit)
    return { kind: 'success', text: `maxSessions 已更新为 ${limit}` }
  } catch (error) {
    return { kind: 'error', text: `maxSessions 更新失败：${errorMessage(error)}` }
  }
}

/** 单会话模式没有环境可管：命令照常注册，但执行时明确提示，而不是静默无效。 */
function environmentOnly(): CommandResultLike {
  return { kind: 'error', text: '该命令仅在环境模式（mode=environment）可用' }
}

/** 只在 profile 提供 commands 服务时注册；`supervisor` 为空表示单会话模式。 */
export function registerCommands(
  ctx: PluginContextLike,
  deps: { supervisor: SessionSupervisor | null; config: ResolvedConfig; rcs: RcsClient },
): void {
  const commands = ctx.get('commands')
  if (!isCommands(commands)) {
    process.stderr.write('[dsh-rcs-plugin] commands service unavailable; slash commands not registered\n')
    return
  }
  const supervisor = deps.supervisor
  commands.register({
    name: 'rcs-max-sessions',
    description: '调整 RCS 环境的最大并发会话数（环境模式）',
    // 不带 input 时，Web composer 会把 `/rcs-max-sessions 3` 当作普通消息发给模型。
    input: { hint: '<正整数>' },
    handler: (invocation) => (supervisor ? runMaxSessionsCommand(supervisor, invocation.rawInput) : environmentOnly()),
  })
  commands.register({
    name: 'rcs-sync',
    description: '把当前 dsh 会话同步到 RCS（只在环境模式可用，不回填历史）',
    handler: (invocation) =>
      supervisor
        ? syncSession({ ctx, supervisor, config: deps.config, rcs: deps.rcs }, invocation.agent?.id ?? '')
        : environmentOnly(),
  })
}
