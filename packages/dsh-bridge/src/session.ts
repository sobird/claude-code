import { randomUUID } from 'node:crypto'

import type { BridgeConfig } from './config'
import { DshClient } from './dsh'
import { RcsClient, type WorkerFrame, type WorkerSession } from './rcs'
import {
  allowRulesOf,
  approvalRequestEvent,
  approvalResult,
  parseControlResponse,
  promptBlocks,
  questionRequestEvent,
  questionResult,
  translateSessionEvent,
  type ControlResolution,
  type RcsEvent,
} from './translate'
import { asNumber, asText, errorMessage, isRecord } from './util'

const HEARTBEAT_MS = 30_000
const RECONNECT_MS = 1_000

interface PendingHuman {
  kind: 'approval' | 'question'
  params: Record<string, unknown>
  resolve: (result: Record<string, unknown>) => void
}

export interface Bridge {
  sessionId: string
  /** 停止 dsh、补发中断结果并释放所有循环。 */
  stop(): Promise<void>
  /** stop 之后 resolve。 */
  done: Promise<void>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

/**
 * 一条 RCS 会话的桥接：把 RCS 的入站消息喂给 dsh，把 dsh 的事件/审批/提问
 * 翻译回 RCS。dsh 一律以「SDK profile + cse_ id 作为会话 id」运行，
 * 因此停止后可以用同一 id 恢复。
 */
class SessionBridge implements Bridge {
  readonly sessionId: string
  readonly done: Promise<void>

  private readonly config: BridgeConfig
  private readonly rcs: RcsClient
  private readonly worker: WorkerSession
  private readonly abort = new AbortController()
  private readonly pendingHuman = new Map<string, PendingHuman>()
  private readonly alwaysAllow = new Set<string>()

  private dsh: DshClient | null = null
  private starting: Promise<DshClient> | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private lastSequence = 0
  private turnOpen = false
  private resumeRequired = false
  private stopping = false
  /** 串行化上报，保证 dsh 事件到 RCS 的顺序与产生顺序一致。 */
  private posting: Promise<void> = Promise.resolve()

  private constructor(config: BridgeConfig, rcs: RcsClient, worker: WorkerSession) {
    this.config = config
    this.rcs = rcs
    this.worker = worker
    this.sessionId = worker.sessionId
    this.done = new Promise<void>((resolve) => {
      this.abort.signal.addEventListener('abort', () => resolve(), { once: true })
    })
  }

  static async start(config: BridgeConfig): Promise<SessionBridge> {
    const rcs = new RcsClient({ baseUrl: config.rcsBaseUrl, apiKey: config.apiKey })
    const sessionId = await rcs.createSession(config.title)
    const worker = await rcs.openWorker(sessionId)
    const bridge = new SessionBridge(config, rcs, worker)
    await bridge.begin()
    return bridge
  }

  private async begin(): Promise<void> {
    await this.ensureDsh()
    await this.setStatus('idle')
    this.startHeartbeat()
    void this.pump()
  }

  async stop(): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    await this.cancelPendingHuman('Interrupted')
    if (this.turnOpen) {
      this.turnOpen = false
      await this.post([
        {
          type: 'result',
          payload: {
            type: 'result',
            subtype: 'aborted',
            uuid: `dsh-abort-${randomUUID()}`,
            is_error: true,
            result: 'Interrupted',
          },
        },
      ])
    }
    await this.setStatus('idle')
    await this.dsh?.stop()
    this.dsh = null
    this.abort.abort()
  }

  private async pump(): Promise<void> {
    while (!this.abort.signal.aborted) {
      try {
        for await (const frame of this.rcs.streamEvents(this.worker, this.lastSequence, this.abort.signal)) {
          await this.handleFrame(frame)
        }
      } catch (error) {
        if (this.abort.signal.aborted) return
        process.stderr.write(`[dsh-bridge] worker stream: ${errorMessage(error)}\n`)
      }
      if (this.abort.signal.aborted) return
      await sleep(RECONNECT_MS)
    }
  }

  private async handleFrame(frame: WorkerFrame): Promise<void> {
    if (frame.sequenceNum !== null) this.lastSequence = Math.max(this.lastSequence, frame.sequenceNum)
    const payload = frame.payload
    const type = asText(payload.type) || frame.eventType

    if (type === 'user' || frame.eventType === 'user') {
      await this.handleUser(payload)
      return
    }
    if (type === 'control_response' || type === 'permission_response') {
      await this.handleControlResponse(payload)
      return
    }
    if (type === 'control_request') {
      const request = recordOf(payload.request)
      if (request?.subtype === 'interrupt') await this.interrupt()
      return
    }
    if (frame.eventType === 'interrupt') await this.interrupt()
  }

  private async handleUser(payload: Record<string, unknown>): Promise<void> {
    const blocks = promptBlocks(payload)
    if (blocks.length === 0) return
    try {
      const dsh = await this.ensureDsh()
      this.turnOpen = true
      await this.setStatus('running')
      await dsh.request('session/prompt', { sessionId: this.sessionId, contentBlocks: blocks })
    } catch (error) {
      this.turnOpen = false
      await this.postResultError(errorMessage(error))
      await this.setStatus('idle')
    }
  }

  private async handleControlResponse(payload: Record<string, unknown>): Promise<void> {
    const response = recordOf(payload.response)
    const requestId = asText(response?.request_id) || asText(payload.request_id)
    const resolution = parseControlResponse(payload)
    if (!requestId || !resolution) return
    const pending = this.pendingHuman.get(requestId)
    if (!pending) return
    this.pendingHuman.delete(requestId)

    if (pending.kind === 'approval') {
      if (resolution.approved) this.rememberAllowRules(resolution)
      pending.resolve(approvalResult(resolution))
    } else {
      pending.resolve(questionResult(pending.params, resolution))
    }
    await this.setStatus('running')
  }

  private rememberAllowRules(resolution: ControlResolution): void {
    for (const rule of allowRulesOf(resolution)) {
      this.alwaysAllow.add(`${this.sessionId}:${rule.toolName}`)
    }
  }

  /** 停止当前轮：补发待处理卡片的应答、合成 result，下条消息再恢复。 */
  private async interrupt(): Promise<void> {
    if (!this.dsh) return
    this.stopping = true
    await this.cancelPendingHuman('Interrupted')
    await this.dsh.stop()
    this.dsh = null
    this.resumeRequired = true
    if (this.turnOpen) {
      this.turnOpen = false
      await this.post([
        {
          type: 'result',
          payload: {
            type: 'result',
            subtype: 'aborted',
            uuid: `dsh-abort-${randomUUID()}`,
            is_error: true,
            result: 'Interrupted',
          },
        },
      ])
    }
    await this.setStatus('idle')
    this.stopping = false
  }

  /** 待处理审批/提问统一收尾；同时补发 control_response，避免 UI 卡片卡住。 */
  private async cancelPendingHuman(message: string): Promise<void> {
    const pending = [...this.pendingHuman.entries()]
    this.pendingHuman.clear()
    if (pending.length === 0) return
    const events: RcsEvent[] = []
    for (const [requestId, entry] of pending) {
      entry.resolve(entry.kind === 'approval' ? { outcome: 'cancelled' } : { cancelled: true })
      events.push({
        type: 'control_response',
        payload: {
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: requestId,
            response: { behavior: 'deny', message },
          },
        },
      })
    }
    await this.post(events)
  }

  private handleNotification(method: string, params: Record<string, unknown>): void {
    if (method === 'session.event') {
      void this.handleSessionEvent(params)
      return
    }
    if (method === 'session.status') {
      const sessionId = asText(params.sessionId)
      if (sessionId !== this.sessionId) return
      if (params.status === 'idle' && this.pendingHuman.size === 0) void this.setStatus('idle')
      // 等待审批/提问期间保持 requires_action，别被轮次内的 running 事件盖掉。
      if (params.status === 'running' && this.pendingHuman.size === 0) void this.setStatus('running')
    }
  }

  private async handleSessionEvent(params: Record<string, unknown>): Promise<void> {
    const sessionId = asText(params.sessionId)
    if (sessionId !== this.sessionId) return
    const event = recordOf(params.event)
    if (!event) return
    const type = asText(event.type)
    if (type === 'turn/start') this.turnOpen = true
    if (type === 'turn/end') this.turnOpen = false

    const events = translateSessionEvent({ type, seq: asNumber(event.seq), data: recordOf(event.data) ?? {} })
    await this.post(events)
    if (type === 'turn/end' && this.pendingHuman.size === 0) await this.setStatus('idle')
  }

  private async handleRequest(
    _rpcId: string | number,
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const sessionId = asText(params.sessionId)
    if (sessionId !== this.sessionId) {
      return method === 'approval/request' ? { outcome: 'cancelled' } : { cancelled: true }
    }

    if (method === 'approval/request') {
      const toolName = asText(params.toolName) || 'unknown'
      // 「总是允许」只记在适配器内存里：命中后直接放行，不再打扰 RCS。
      if (this.alwaysAllow.has(`${sessionId}:${toolName}`)) return { outcome: 'allowed-once' }
      const requestId = `perm_${randomUUID()}`
      const result = this.awaitHuman('approval', requestId, params)
      await this.post([approvalRequestEvent(requestId, params)])
      await this.setStatus('requires_action', { toolName, description: asText(params.reason) })
      return result
    }

    if (method === 'user-question/ask') {
      const requestId = `ask_${randomUUID()}`
      const questions = Array.isArray(params.questions) ? params.questions : []
      const first = recordOf(questions[0])
      const intent = recordOf(first?.intent)
      const toolName = intent?.kind === 'plan-review' ? 'ExitPlanMode' : 'AskUserQuestion'
      const result = this.awaitHuman('question', requestId, params)
      await this.post([questionRequestEvent(requestId, params)])
      await this.setStatus('requires_action', { toolName, description: asText(first?.question) })
      return result
    }

    throw new Error(`unsupported dsh host request: ${method}`)
  }

  private awaitHuman(
    kind: 'approval' | 'question',
    requestId: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      this.pendingHuman.set(requestId, { kind, params, resolve })
    })
  }

  private async ensureDsh(): Promise<DshClient> {
    if (this.dsh?.isAlive && !this.resumeRequired) return this.dsh
    this.starting ??= this.startDsh().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async startDsh(): Promise<DshClient> {
    let client: DshClient | null = null
    const dsh = DshClient.spawn(this.config.dsh, {
      onNotification: (method, params) => this.handleNotification(method, params),
      onRequest: (rpcId, method, params) => this.handleRequest(rpcId, method, params),
      onExit: (code, signal) => {
        // 主动停止/中断会自己处理收尾；只对当前实例的意外退出作出反应。
        if (this.stopping || this.dsh !== client) return
        process.stderr.write(`[dsh-bridge] dsh exited unexpectedly (code=${String(code)}, signal=${String(signal)})\n`)
        void this.cancelPendingHuman('dsh exited')
        this.dsh = null
        this.resumeRequired = true
        if (this.turnOpen) {
          this.turnOpen = false
          void this.postResultError('dsh exited unexpectedly')
        }
        void this.setStatus('idle')
      },
    })
    client = dsh

    try {
      await dsh.request('initialize', {
        cwd: this.config.workdir,
        provider: this.config.provider,
        model: this.config.model,
        approvalRequests: true,
        capabilities: { userQuestions: true },
      })
      if (this.resumeRequired) {
        // 省略 permissionMode，保留 dsh 已持久化的权限预设。
        await dsh.request('session/resume', { sessionId: this.sessionId })
        this.resumeRequired = false
      }
    } catch (error) {
      await dsh.stop()
      throw error
    }
    this.dsh = dsh
    return dsh
  }

  private startHeartbeat(): void {
    const beat = () => {
      void this.rcs.heartbeat(this.worker).catch((error: unknown) => {
        process.stderr.write(`[dsh-bridge] heartbeat: ${errorMessage(error)}\n`)
      })
    }
    beat()
    this.heartbeat = setInterval(beat, HEARTBEAT_MS)
    this.heartbeat.unref?.()
  }

  private post(events: readonly RcsEvent[]): Promise<void> {
    if (events.length === 0) return this.posting
    const payloads = events.map((event) => ({ type: event.type, ...event.payload }))
    this.posting = this.posting.then(async () => {
      try {
        await this.rcs.postEvents(this.worker, payloads)
      } catch (error) {
        process.stderr.write(`[dsh-bridge] post events: ${errorMessage(error)}\n`)
      }
    })
    return this.posting
  }

  private async postResultError(message: string): Promise<void> {
    await this.post([
      {
        type: 'result',
        payload: {
          type: 'result',
          subtype: 'error',
          uuid: `dsh-error-${randomUUID()}`,
          is_error: true,
          result: message,
        },
      },
    ])
  }

  private async setStatus(
    status: 'idle' | 'running' | 'requires_action',
    details?: { toolName: string; description?: string },
  ): Promise<void> {
    try {
      await this.rcs.setWorkerStatus(this.worker, status, details)
    } catch (error) {
      process.stderr.write(`[dsh-bridge] status ${status}: ${errorMessage(error)}\n`)
    }
  }
}

export function startBridge(config: BridgeConfig): Promise<Bridge> {
  return SessionBridge.start(config)
}
