import { RcsClient, errorMessage } from '@sobird/dsh-bridge/core'

import { startPluginBridge } from './bridge'
import { registerCommands } from './commands'
import { resolveConfig, resolveConnection } from './config'
import { ensureCredentials } from './credentials-flow'
import { DeviceAuthClient } from './device-auth'
import { bridgeStateDir } from './environment-state'
import { openBrowser } from './open-browser'
import { startSupervisor } from './supervisor'
import type { PluginContextLike } from './types'

/** Cordis 插件名；与 `cordis.patch.yml` 的行 id 区分（行 id 是 `rcs-bridge`）。 */
export const name = 'rcs-bridge'

/**
 * 等待 agents 服务；agent 本身在首条消息时懒创建，避开 agent-loop 的加载顺序。
 * `sessionQuery` 用于启动时复用既有 dsh 会话，dsh-base（web/sdk profile 的底座）都会挂载它。
 */
export const inject = ['agents', 'sessionQuery']

/** 测试可注入的副作用；生产路径全部走默认值。 */
export interface ApplyDeps {
  /** 默认 `$DSH_HOME/rcs-bridge`。 */
  stateDir?: string
  openUrl?: (url: string) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * 把当前 dsh 进程接到一条 RCS 会话；卸载时中止桥接。
 *
 * 没有任何显式凭据时先走设备码配对（阻塞到批准或超时），拿到 key 后再解析其余配置。
 */
export async function apply(ctx: PluginContextLike, config: unknown, deps: ApplyDeps = {}): Promise<void> {
  try {
    const connection = resolveConnection(config)
    const apiKey =
      connection.apiKey ??
      (await ensureCredentials(
        { rcsBaseUrl: connection.rcsBaseUrl },
        {
          stateDir: deps.stateDir ?? bridgeStateDir(process.env),
          client: new DeviceAuthClient({ baseUrl: connection.rcsBaseUrl }),
          openUrl: deps.openUrl ?? openBrowser,
          log: (line) => process.stderr.write(`[dsh-rcs-plugin] ${line}\n`),
          now: deps.now,
          sleep: deps.sleep,
        },
      ))

    const resolved = resolveConfig(config, process.env, { apiKey })
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
