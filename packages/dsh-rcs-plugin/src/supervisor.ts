import { hostname } from 'node:os'

import {
  RcsClient,
  RcsEnvironmentClient,
  RcsHttpError,
  errorMessage,
  toWorkerSession,
  type EnvironmentRegistration,
  type WorkerSession,
  type WorkItem,
} from '@sobird/dsh-bridge/core'

import { InProcessBridge, type PluginBridge } from './bridge'
import type { ResolvedConfig } from './config'
import { bridgeStateDir, readEnvironmentId, writeEnvironmentId } from './environment-state'
import { agentIdForRcs, readSidecar } from './sidecar'
import type { PluginContextLike } from './types'

/** 环境 token 失效后重注册的退避；注册本身很少失败。 */
const REGISTER_BACKOFF_MS = 1_000
/** 空轮询节奏：服务端长轮询已经占住时间，这里只避免忙等。 */
const DEFAULT_EMPTY_POLL_MS = 1_000
const POLL_TIMEOUT_SECONDS = 25
const RECLAIM_OLDER_THAN_MS = 5_000
const WORKER_TYPE = 'deepseek'

export interface SessionSupervisor {
  readonly environmentId: string
  /** 当前存活桥上上限（本地立即生效；RCS 侧上报可能滞后）。 */
  readonly maxSessions: number
  bridgeIds(): readonly string[]
  /** 起一条桥；同一 `rcsSessionId` 幂等，传入 `worker` 时不再握手。 */
  attach(rcsSessionId: string, agentSessionId: string, worker?: WorkerSession): Promise<PluginBridge>
  /** 运行时修改上限：重注册环境，不停止任何存活桥。 */
  setMaxSessions(limit: number): Promise<void>
  dispose(): Promise<void>
}

export interface SupervisorOptions {
  emptyPollDelayMs?: number
}

function log(line: string): void {
  process.stderr.write(`[dsh-rcs-plugin] ${line}\n`)
}

class EnvironmentSupervisor implements SessionSupervisor {
  private environmentIdValue: string
  private environmentSecret: string
  private limit: number
  private readonly stateDir: string
  private readonly bridges = new Map<string, PluginBridge>()
  private readonly abort = new AbortController()
  private loop: Promise<void> | null = null

  constructor(
    private readonly ctx: PluginContextLike,
    private readonly config: ResolvedConfig,
    private readonly rcs: RcsClient,
    private readonly client: RcsEnvironmentClient,
    registration: EnvironmentRegistration,
    stateDir: string,
    private readonly options: SupervisorOptions,
  ) {
    this.environmentIdValue = registration.environmentId
    this.environmentSecret = registration.environmentSecret
    this.limit = config.maxSessions
    this.stateDir = stateDir
  }

  get environmentId(): string {
    return this.environmentIdValue
  }

  get maxSessions(): number {
    return this.limit
  }

  bridgeIds(): readonly string[] {
    return [...this.bridges.keys()]
  }

  start(): void {
    this.loop = this.pollLoop()
  }

  async attach(rcsSessionId: string, agentSessionId: string, worker?: WorkerSession): Promise<PluginBridge> {
    const existing = this.bridges.get(rcsSessionId)
    if (existing) return existing
    if (this.bridges.size >= this.limit) {
      log(`attach ${rcsSessionId}: over maxSessions=${this.limit}, continuing anyway`)
    }
    const session = worker ?? (await this.rcs.openWorker(rcsSessionId))
    const bridge = await this.startBridge(rcsSessionId, agentSessionId, session)
    if (!bridge) throw new Error(`session ${rcsSessionId} is no longer available`)
    return bridge
  }

  async setMaxSessions(limit: number): Promise<void> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error('maxSessions must be a positive integer')
    }
    // 本地先生效（调高立即恢复 poll、调低立即暂停）；上报失败只记日志。
    this.limit = limit
    try {
      const registration = await this.register(limit)
      log(`maxSessions=${limit} (environment ${registration.environmentId})`)
    } catch (error) {
      log(`maxSessions=${limit} applied locally; report failed: ${errorMessage(error)}`)
    }
  }

  async dispose(): Promise<void> {
    this.abort.abort()
    await this.loop?.catch(() => undefined)
    const bridges = [...this.bridges.values()]
    this.bridges.clear()
    await Promise.all(
      bridges.map((bridge) =>
        bridge.stop().catch((error: unknown) => {
          log(`stop bridge: ${errorMessage(error)}`)
        }),
      ),
    )
    try {
      await this.client.deregister(this.environmentIdValue)
    } catch (error) {
      log(`deregister: ${errorMessage(error)}`)
    }
  }

  private async pollLoop(): Promise<void> {
    while (!this.abort.signal.aborted) {
      if (this.bridges.size >= this.limit) {
        await this.delay()
        continue
      }
      try {
        const item = await this.client.poll(this.environmentIdValue, this.environmentSecret, {
          timeoutSeconds: POLL_TIMEOUT_SECONDS,
          reclaimOlderThanMs: RECLAIM_OLDER_THAN_MS,
          signal: this.abort.signal,
        })
        if (!item) {
          await this.delay()
          continue
        }
        await this.dispatch(item)
      } catch (error) {
        if (this.abort.signal.aborted) return
        if (error instanceof RcsHttpError && error.status === 401) {
          await this.reRegister()
          continue
        }
        log(`poll: ${errorMessage(error)}`)
        await this.delay(REGISTER_BACKOFF_MS)
      }
    }
  }

  /** ack 后起桥；重复派发（ack 丢失/重启）按 rcsSessionId 幂等。 */
  private async dispatch(item: WorkItem): Promise<void> {
    try {
      await this.client.ack(this.environmentIdValue, item.id, this.environmentSecret)
    } catch (error) {
      if (error instanceof RcsHttpError && error.status === 404) return
      // ack 失败会让服务端重投；桥本身幂等，所以照常起桥。
      log(`ack ${item.id}: ${errorMessage(error)}`)
    }
    if (this.bridges.has(item.sessionId)) return
    const sidecar = await readSidecar(this.stateDir)
    const agentSessionId = agentIdForRcs(sidecar, item.sessionId) ?? item.sessionId
    await this.startBridge(item.sessionId, agentSessionId, toWorkerSession(item, this.config.rcsBaseUrl))
  }

  private async startBridge(
    rcsSessionId: string,
    agentSessionId: string,
    worker: WorkerSession,
  ): Promise<PluginBridge | undefined> {
    const existing = this.bridges.get(rcsSessionId)
    if (existing) return existing
    const bridge = new InProcessBridge(this.ctx, this.config, this.rcs, worker, agentSessionId, {
      onGone: () => {
        void this.remove(rcsSessionId)
      },
    })
    this.bridges.set(rcsSessionId, bridge)
    try {
      await bridge.begin()
    } catch (error) {
      this.bridges.delete(rcsSessionId)
      if (error instanceof RcsHttpError && error.status === 404) return undefined
      throw error
    }
    return bridge
  }

  /** RCS 删除会话后释放槽位：停桥并从表里移除。 */
  private async remove(rcsSessionId: string): Promise<void> {
    const bridge = this.bridges.get(rcsSessionId)
    if (!bridge) return
    this.bridges.delete(rcsSessionId)
    log(`session ${rcsSessionId} is gone; stopping bridge`)
    await bridge.stop().catch((error: unknown) => {
      log(`stop ${rcsSessionId}: ${errorMessage(error)}`)
    })
  }

  /** 401 时用用户 key 重注册（带旧 id），换新 secret；失败则退避重试。 */
  private async reRegister(): Promise<void> {
    while (!this.abort.signal.aborted) {
      try {
        const registration = await this.register(this.limit)
        log(`environment re-registered (${registration.environmentId})`)
        return
      } catch (error) {
        log(`environment re-register: ${errorMessage(error)}`)
        await this.delay(REGISTER_BACKOFF_MS)
      }
    }
  }

  private async register(maxSessions: number): Promise<EnvironmentRegistration> {
    const registration = await this.client.register({
      environmentId: this.environmentIdValue,
      machineName: hostname(),
      directory: this.config.workdir,
      maxSessions,
      workerType: WORKER_TYPE,
    })
    this.environmentIdValue = registration.environmentId
    this.environmentSecret = registration.environmentSecret
    await writeEnvironmentId(this.stateDir, registration.environmentId)
    return registration
  }

  private delay(ms: number = this.options.emptyPollDelayMs ?? DEFAULT_EMPTY_POLL_MS): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        this.abort.signal.removeEventListener('abort', done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      timer.unref?.()
      this.abort.signal.addEventListener('abort', done, { once: true })
    })
  }
}

/** 注册环境、重排 idle 会话，并启动 poll 循环。 */
export async function startSupervisor(
  ctx: PluginContextLike,
  config: ResolvedConfig,
  options: SupervisorOptions = {},
): Promise<SessionSupervisor> {
  const client = new RcsEnvironmentClient({ baseUrl: config.rcsBaseUrl, apiKey: config.apiKey })
  const stateDir = bridgeStateDir()
  const previousId = config.environmentId ?? (await readEnvironmentId(stateDir))
  const registration = await client.register({
    environmentId: previousId,
    machineName: hostname(),
    directory: config.workdir,
    maxSessions: config.maxSessions,
    workerType: WORKER_TYPE,
  })
  await writeEnvironmentId(stateDir, registration.environmentId)

  const rcs = new RcsClient({ baseUrl: config.rcsBaseUrl, apiKey: config.apiKey })
  const supervisor = new EnvironmentSupervisor(ctx, config, rcs, client, registration, stateDir, options)
  try {
    await client.reconnect(registration.environmentId)
  } catch (error) {
    log(`environment reconnect: ${errorMessage(error)}`)
  }
  supervisor.start()
  log(`environment ${registration.environmentId} registered (maxSessions=${config.maxSessions})`)
  return supervisor
}
