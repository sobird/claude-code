import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import type { DshLaunchConfig } from './config'
import { asText, errorMessage, isRecord } from './util'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/** dsh SDK 的宿主回调：通知只读，宿主请求必须应答，否则 dsh 侧会一直等待。 */
export interface DshClientOptions {
  onNotification?: (method: string, params: Record<string, unknown>) => void
  onRequest?: (id: string | number, method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
}

function paramsOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

/**
 * dsh SDK JSON-RPC 客户端：子进程以独立进程组启动，`stop()` 杀整组，
 * 避免工具拉起的分支进程成为孤儿。
 */
export class DshClient {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly options: DshClientOptions
  private readonly pending = new Map<string | number, PendingRequest>()
  private readonly exited: Promise<void>
  private buffer = ''
  private closed = false

  private constructor(child: ChildProcessWithoutNullStreams, options: DshClientOptions) {
    this.child = child
    this.options = options
    this.exited = new Promise((resolve) => {
      child.once('exit', (code, signal) => {
        this.closed = true
        this.failPending(new Error(`dsh exited (code=${String(code)}, signal=${String(signal)})`))
        this.options.onExit?.(code, signal)
        resolve()
      })
    })
    child.stdout.on('data', (chunk: Buffer) => this.onData(chunk))
    child.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk))
    child.on('error', (error) => {
      this.closed = true
      this.failPending(error)
    })
    // stdin 是唯一入口；子进程关闭它意味着协议已不可用。
    child.stdin.on('error', (error) => {
      this.closed = true
      this.failPending(error)
    })
  }

  static spawn(launch: DshLaunchConfig, options: DshClientOptions = {}): DshClient {
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    })
    return new DshClient(child, options)
  }

  get pid(): number | undefined {
    return this.child.pid
  }

  get isAlive(): boolean {
    return !this.closed
  }

  /** 发送 JSON-RPC 请求；进程退出后所有未决请求一起失败。 */
  request(method: string, params: object): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('dsh is not running'))
    const id = `bridge_${randomUUID().replaceAll('-', '')}`
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.write({ jsonrpc: '2.0', id, method, params })
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /** 只发通知，不等待响应。 */
  notify(method: string, params?: object): void {
    if (this.closed) return
    this.write(params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params })
  }

  /** 等待子进程退出；用于 kill 后同步状态。 */
  waitForExit(): Promise<void> {
    return this.exited
  }

  /**
   * 停止 dsh：先对整个进程组发 SIGTERM（dsh 会补写合成 `turn/end`），
   * 2 秒后仍在则 SIGKILL。返回时进程一定已经退出。
   */
  async stop(): Promise<void> {
    if (this.closed) return
    this.signalGroup('SIGTERM')
    const timer = setTimeout(() => this.signalGroup('SIGKILL'), 2000)
    try {
      await this.exited
    } finally {
      clearTimeout(timer)
    }
  }

  private signalGroup(signal: NodeJS.Signals): void {
    const pid = this.child.pid
    if (pid === undefined) return
    try {
      process.kill(-pid, signal)
    } catch {
      try {
        this.child.kill(signal)
      } catch {
        // 进程已经退出。
      }
    }
  }

  private write(message: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8')
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) break
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line) this.handleLine(line)
    }
  }

  private handleLine(line: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return
    }
    if (!isRecord(parsed)) return
    const id = parsed.id
    const method = asText(parsed.method)
    const hasId = typeof id === 'string' || typeof id === 'number'
    if (hasId && method) {
      void this.handleIncomingRequest(id, method, paramsOf(parsed.params))
      return
    }
    if (hasId) {
      this.handleIncomingResponse(id, parsed)
      return
    }
    if (method) this.options.onNotification?.(method, paramsOf(parsed.params))
  }

  private async handleIncomingRequest(
    id: string | number,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    let result: Record<string, unknown>
    try {
      result = this.options.onRequest ? await this.options.onRequest(id, method, params) : this.fallbackResult(method)
    } catch (error) {
      process.stderr.write(`[dsh-bridge] ${method} handler failed: ${errorMessage(error)}\n`)
      result = this.fallbackResult(method)
    }
    if (this.closed) return
    this.write({ jsonrpc: '2.0', id, result })
  }

  /** 宿主处理失败时的保守答复：审批按取消、提问按关闭，绝不让 dsh 挂起。 */
  private fallbackResult(method: string): Record<string, unknown> {
    return method === 'approval/request' ? { outcome: 'cancelled' } : { cancelled: true }
  }

  private handleIncomingResponse(id: string | number, frame: Record<string, unknown>): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    const error = frame.error
    if (isRecord(error)) {
      pending.reject(new Error(asText(error.message) || 'dsh JSON-RPC error'))
      return
    }
    pending.resolve(frame.result)
  }

  private failPending(error: Error): void {
    const waiters = [...this.pending.values()]
    this.pending.clear()
    for (const waiter of waiters) waiter.reject(error)
  }
}
