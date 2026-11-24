import { errorMessage, type RcsClient } from '@sobird/dsh-bridge/core'

import type { ResolvedConfig } from './config'
import { clearCredentials } from './credentials'
import { awaitPairing, requestPairing, type DeviceAuthLike } from './credentials-flow'
import { DeviceAuthClient, type DeviceGrant } from './device-auth'
import { bridgeStateDir } from './environment-state'
import { openBrowser } from './open-browser'
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

/** `/rcs-login` 的依赖；测试注入假客户端与临时目录。 */
export interface LoginDeps {
  config: ResolvedConfig
  stateDir?: string
  deviceClient?: DeviceAuthLike
  openUrl?: (url: string) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * `/rcs-login`：忽略已存凭据重新配对。命令结果气泡只显示返回值，所以短码必须立即
 * 回给用户（Web UI 看不到 stderr）；批准后的轮询与落盘在后台继续，失败只记 stderr。
 */
export async function runLoginCommand(deps: LoginDeps): Promise<CommandResultLike> {
  const stateDir = deps.stateDir ?? bridgeStateDir()
  const log = (line: string): void => {
    process.stderr.write(`[dsh-rcs-plugin] ${line}\n`)
  }
  const client = deps.deviceClient ?? new DeviceAuthClient({ baseUrl: deps.config.rcsBaseUrl })

  let grant: DeviceGrant
  try {
    grant = await requestPairing(client, { openUrl: deps.openUrl ?? openBrowser, log })
  } catch (error) {
    return { kind: 'error', text: `配对失败：${errorMessage(error)}` }
  }

  void awaitPairing(client, stateDir, deps.config.rcsBaseUrl, grant, {
    log,
    now: deps.now,
    sleep: deps.sleep,
  }).catch((error: unknown) => log(`pairing: ${errorMessage(error)}`))

  return {
    kind: 'success',
    text: `请在 ${grant.verificationUri} 输入短码 ${grant.userCode} 批准；批准后凭据自动保存，重启 profile 生效`,
  }
}

/** `/rcs-logout`：删除本机凭据文件；不存在也算成功。 */
export async function runLogoutCommand(stateDir: string): Promise<CommandResultLike> {
  try {
    await clearCredentials(stateDir)
    return { kind: 'success', text: '已清除本机保存的凭据；若环境变量或配置仍提供 key，则继续生效' }
  } catch (error) {
    return { kind: 'error', text: `清除凭据失败：${errorMessage(error)}` }
  }
}

export interface RegisterCommandsDeps extends LoginDeps {
  supervisor: SessionSupervisor | null
  rcs: RcsClient
}

/** 只在 profile 提供 commands 服务时注册；`supervisor` 为空表示单会话模式。 */
export function registerCommands(ctx: PluginContextLike, deps: RegisterCommandsDeps): void {
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

  // 配对命令与模式无关：单会话模式下也可能需要重新授权。
  const stateDir = deps.stateDir ?? bridgeStateDir()
  commands.register({
    name: 'rcs-login',
    description: '重新进行设备码配对，并把新 key 保存到本机',
    handler: () =>
      runLoginCommand({
        config: deps.config,
        stateDir,
        deviceClient: deps.deviceClient,
        openUrl: deps.openUrl,
        now: deps.now,
        sleep: deps.sleep,
      }),
  })
  commands.register({
    name: 'rcs-logout',
    description: '清除本机保存的 RCS 凭据',
    handler: () => runLogoutCommand(stateDir),
  })
}
