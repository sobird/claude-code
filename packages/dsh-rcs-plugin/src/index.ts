import { RcsClient, errorMessage } from '@sobird/dsh-bridge/core'

import { startPluginBridge } from './bridge'
import { registerCommands } from './commands'
import { resolveConfig } from './config'
import { startSupervisor } from './supervisor'
import type { PluginContextLike } from './types'

/** Cordis 插件名；与 `cordis.patch.yml` 的行 id 区分（行 id 是 `rcs-bridge`）。 */
export const name = 'rcs-bridge'

/**
 * 等待 agents 服务；agent 本身在首条消息时懒创建，避开 agent-loop 的加载顺序。
 * `sessionQuery` 用于启动时复用既有 dsh 会话，dsh-base（web/sdk profile 的底座）都会挂载它。
 */
export const inject = ['agents', 'sessionQuery']

/** 把当前 dsh 进程接到一条 RCS 会话；卸载时中止桥接。 */
export async function apply(ctx: PluginContextLike, config: unknown): Promise<void> {
  try {
    const resolved = resolveConfig(config)
    const rcs = new RcsClient({ baseUrl: resolved.rcsBaseUrl, apiKey: resolved.apiKey })
    if (resolved.mode === 'environment') {
      const supervisor = await startSupervisor(ctx, resolved)
      registerCommands(ctx, { supervisor, config: resolved, rcs })
      process.stderr.write(
        `[dsh-rcs-plugin] attached to ${resolved.rcsBaseUrl} environment ${supervisor.environmentId}\n`,
      )
      ctx.effect(() => () => supervisor.dispose())
    } else {
      const bridge = await startPluginBridge(ctx, resolved)
      // 单会话模式也注册命令：执行时返回「仅在环境模式可用」的提示。
      registerCommands(ctx, { supervisor: null, config: resolved, rcs })
      process.stderr.write(`[dsh-rcs-plugin] attached to ${resolved.rcsBaseUrl} session ${bridge.rcsSessionId}\n`)
      ctx.effect(() => () => bridge.stop())
    }
  } catch (error) {
    process.stderr.write(`[dsh-rcs-plugin] failed: ${errorMessage(error)}\n`)
    throw error
  }
}
