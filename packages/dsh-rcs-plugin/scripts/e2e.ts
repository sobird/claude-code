/**
 * 真实端到端（可选，不进 `bun test`）：真 Postgres + 真 RCS 网关 + 真 dsh（插件宿主）+ 真模型。
 *
 * 运行（从 packages/dsh-rcs-plugin）：
 *   DSH_REPO=/path/to/deepseek-harness DEEPSEEK_API_KEY=sk-... bun scripts/e2e.ts
 *
 * 必需：
 *   - DATABASE_URL / RCS_AUTH_SECRET：先读 ../rcs/.env，再用同名环境变量覆盖。
 *   - DSH_REPO（deepseek-harness 源码 checkout）或 DSH_BIN（已安装的 dsh）。
 *   - DEEPSEEK_API_KEY（缺失时回退 ANTHROPIC_AUTH_TOKEN）：dsh deepseek-official 路由的凭据。
 * 可选：
 *   - E2E_RCS_PORT（默认 4100）、E2E_RCS_API_KEY（默认 e2e-legacy-key）
 *   - DSH_PROVIDER（默认 deepseek-official）、DSH_MODEL（默认 deepseek-v4-flash）、NODE_BIN
 *   - E2E_VERBOSE=1：实时打印网关/宿主日志
 *
 * 覆盖：临时 DSH_HOME 里 `dsh plugin add` 本包 → 宿主加载插件并 attached → 纯文本轮 →
 * bash 工具轮（可选中途审批）→ interrupt → aborted。首次安装需要网络与 pnpm。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

interface Child {
  name: string
  proc: ReturnType<typeof Bun.spawn>
  logs: string[]
}

interface HistoryEvent {
  type: string
  payload?: Record<string, unknown>
  seqNum?: number
}

const pluginDir = resolve(import.meta.dir, '..')
const rcsDir = resolve(import.meta.dir, '../../rcs')
const verbose = process.env.E2E_VERBOSE === '1'

const port = process.env.E2E_RCS_PORT?.trim() || '4100'
const baseUrl = `http://localhost:${port}`
const apiKey = process.env.E2E_RCS_API_KEY?.trim() || 'e2e-legacy-key'

function usage(message: string): never {
  process.stderr.write(`e2e: ${message}\n`)
  process.exit(2)
}

/** 读取 packages/rcs/.env；同名环境变量优先。 */
function readRcsEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  let text = ''
  try {
    text = readFileSync(join(rcsDir, '.env'), 'utf8')
  } catch {
    return out
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const value = line.slice(eq + 1).trim()
    out[line.slice(0, eq).trim()] = value.replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...process.env, ...readRcsEnv() }
const databaseUrl = env.DATABASE_URL?.trim()
const authSecret = env.RCS_AUTH_SECRET?.trim()
if (!databaseUrl) usage('缺少 DATABASE_URL（packages/rcs/.env 或环境变量）')
if (!authSecret) usage('缺少 RCS_AUTH_SECRET（packages/rcs/.env 或环境变量）')

const dshRepo = env.DSH_REPO?.trim()
const dshBin = env.DSH_BIN?.trim() || 'dsh'
if (!dshRepo && !env.DSH_BIN?.trim()) usage('需要 DSH_REPO（源码 checkout）或 DSH_BIN（已安装的 dsh）')

const modelKey = env.DEEPSEEK_API_KEY?.trim() || env.ANTHROPIC_AUTH_TOKEN?.trim()
if (!modelKey) usage('缺少 DEEPSEEK_API_KEY（或 ANTHROPIC_AUTH_TOKEN）')

const provider = env.DSH_PROVIDER?.trim() || 'deepseek-official'
const model = env.DSH_MODEL?.trim() || 'deepseek-v4-flash'

const dshHome = mkdtempSync(join(tmpdir(), 'dsh-home-e2e-'))
const workdir = mkdtempSync(join(tmpdir(), 'dsh-plugin-work-'))
const children: Child[] = []

/** `dsh` 命令行：源码 checkout 用 Node + tsx 跑 bin.ts，否则用已安装的可执行文件。 */
function dshCommand(args: string[]): { command: string[]; cwd: string } {
  if (dshRepo) {
    const nodeBin = env.NODE_BIN?.trim() || 'node'
    return { command: [nodeBin, '--import', 'tsx/esm', 'apps/cli/src/bin.ts', ...args], cwd: dshRepo }
  }
  return { command: [dshBin, ...args], cwd: workdir }
}

function say(line: string): void {
  console.log(line)
}

function expectOk(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function spawn(name: string, command: string[], cwd: string, extraEnv: Record<string, string | undefined>): Child {
  const proc = Bun.spawn(command, {
    cwd,
    env: { ...env, ...extraEnv },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const child: Child = { name, proc, logs: [] }
  children.push(child)
  pipe(child, proc.stdout as ReadableStream<Uint8Array>, process.stdout, false)
  pipe(child, proc.stderr as ReadableStream<Uint8Array>, process.stderr, true)
  return child
}

/** 捕获子进程输出；网关噪声默认只在失败时回放（E2E_VERBOSE=1 或插件宿主 stderr 时实时打印）。 */
function pipe(child: Child, stream: ReadableStream<Uint8Array>, sink: NodeJS.WriteStream, live: boolean): void {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const name = child.name
  void (async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      child.logs.push(text)
      if (live && (verbose || name === 'dsh')) {
        for (const line of text.split('\n')) if (line.trim()) sink.write(`  [${name}] ${line}\n`)
      }
    }
  })().catch(() => {})
}

function tail(child: Child): string {
  return child.logs
    .join('')
    .split('\n')
    .filter((line) => line.trim())
    .slice(-15)
    .join('\n')
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${apiKey}`)
  headers.set('content-type', 'application/json')
  return fetch(`${baseUrl}${path}`, { ...init, headers })
}

async function apiJson(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await api(path, init)
  const text = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status} ${text.slice(0, 200)}`)
  return text ? (JSON.parse(text) as Record<string, unknown>) : {}
}

/** 轮询直到 fn 返回真值；瞬时请求错误继续重试，而不是当成「不存在」。 */
async function pollFor<T>(label: string, fn: () => Promise<T | undefined>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = null
  for (;;) {
    try {
      const value = await fn()
      if (value !== undefined && value !== null && value !== false) return value
    } catch (error) {
      lastError = error
    }
    if (Date.now() > deadline) {
      const suffix = lastError instanceof Error ? ` (last error: ${lastError.message})` : ''
      throw new Error(`timeout waiting for ${label}${suffix}`)
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300))
  }
}

async function history(sessionId: string): Promise<HistoryEvent[]> {
  const body = await apiJson(`/web/sessions/${sessionId}/history?limit=200`)
  const events = body.events
  return Array.isArray(events) ? (events as HistoryEvent[]) : []
}

function results(events: HistoryEvent[]): HistoryEvent[] {
  return events.filter((event) => event.type === 'result').toSorted((a, b) => (a.seqNum ?? 0) - (b.seqNum ?? 0))
}

function assistantText(events: HistoryEvent[]): string {
  const message = events.find((event) => event.type === 'assistant')?.payload?.message
  const content = message && typeof message === 'object' ? (message as { content?: unknown }).content : undefined
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => (block && typeof block === 'object' ? String((block as { text?: unknown }).text ?? '') : ''))
    .join('')
}

function toolResultText(events: HistoryEvent[]): string {
  for (const event of events) {
    if (event.type !== 'user') continue
    const message = event.payload?.message
    if (!message || typeof message !== 'object') continue
    const content = (message as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    const block = content[0]
    if (!block || typeof block !== 'object') continue
    const typed = block as { type?: string; content?: unknown }
    if (typed.type !== 'tool_result' || !Array.isArray(typed.content)) continue
    return typed.content.map((part) => String((part as { text?: unknown }).text ?? '')).join('')
  }
  return ''
}

/** 把本包装进临时 DSH_HOME 的 `sdk` profile；首次会初始化模板。 */
async function installPlugin(): Promise<void> {
  const { command, cwd } = dshCommand(['plugin', '--profile', 'sdk', 'add', pluginDir])
  say(`install: ${command.join(' ')}`)
  const proc = Bun.spawn(command, {
    cwd,
    env: { ...env, DSH_HOME: dshHome },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) {
    process.stderr.write(`install stdout:\n${stdout}\ninstall stderr:\n${stderr}\n`)
    throw new Error(`dsh plugin add 失败（exit ${code}）`)
  }
  say('install: plugin linked into sdk profile')
}

async function main(): Promise<void> {
  say(`DSH_HOME: ${dshHome}`)
  say(`workdir: ${workdir}`)
  say(`dsh: ${dshRepo ? `source ${dshRepo}` : `bin ${dshBin}`} | provider=${provider} model=${model}`)

  // 1) 把插件装进临时 profile（首次自动初始化 sdk 模板，需要 pnpm 与网络）。
  await installPlugin()

  // 2) 网关（真 Postgres）
  spawn('gateway', [process.execPath, 'server/index.ts'], rcsDir, {
    DATABASE_URL: databaseUrl,
    RCS_AUTH_SECRET: authSecret,
    RCS_API_KEYS: apiKey,
    RCS_PORT: port,
    RCS_BASE_URL: baseUrl,
    DSH_HOME: dshHome,
  })
  await pollFor('gateway /health', async () => ((await fetch(`${baseUrl}/health`)).ok ? true : undefined), 40_000)
  say('gateway: /health OK')

  // 3) 真 dsh 加载插件（RCS 传输跑在宿主进程内）
  const { command, cwd } = dshCommand(['--profile', 'sdk'])
  const host = spawn('dsh', command, cwd, {
    DSH_HOME: dshHome,
    RCS_API_KEY: apiKey,
    RCS_BASE_URL: baseUrl,
    DSH_WORKDIR: workdir,
    DSH_PROVIDER: provider,
    DSH_MODEL: model,
    DEEPSEEK_API_KEY: modelKey,
  })

  const sessionId = await pollFor(
    'plugin attach',
    async () => /session (cse_[A-Za-z0-9_-]+)/.exec(host.logs.join(''))?.[1],
    120_000,
  )
  say(`dsh host: attached session ${sessionId}`)

  // 4) 纯文本轮
  await apiJson(`/web/sessions/${sessionId}/events`, {
    method: 'POST',
    body: JSON.stringify({ type: 'user', content: '请只回复两个字符：OK。不要调用任何工具。' }),
  })
  const firstResult = await pollFor('text turn result', async () => results(await history(sessionId))[0], 180_000)
  const text = assistantText(await history(sessionId))
  expectOk(firstResult.payload?.subtype === 'success', 'text turn 未成功')
  expectOk(text.trim().length > 0, 'text turn 没有 assistant 文本')
  say(`text turn: result=${String(firstResult.payload?.subtype)} assistant="${text.trim()}"`)

  // 5) 工具轮（可选审批：出现 control_request 就批准）
  const beforeTool = results(await history(sessionId)).length
  await apiJson(`/web/sessions/${sessionId}/events`, {
    method: 'POST',
    body: JSON.stringify({ type: 'user', content: '用 bash 工具执行 `echo plugin-e2e`，然后把输出原样告诉我。' }),
  })
  void maybeApprove(sessionId)
  const toolResult = await pollFor(
    'tool turn result',
    async () => {
      const all = results(await history(sessionId))
      return all.length > beforeTool ? all[all.length - 1] : undefined
    },
    180_000,
  )
  const afterTool = await history(sessionId)
  const toolUse = afterTool.find((event) => event.type === 'tool_use')
  const output = toolResultText(afterTool)
  expectOk(toolResult.payload?.subtype === 'success', 'tool turn 未成功')
  expectOk(toolUse !== undefined, 'tool turn 没有 tool_use')
  expectOk(output.includes('plugin-e2e'), 'tool 输出未包含 plugin-e2e')
  say(`tool turn: result=success tool=${String(toolUse?.payload?.tool_name)} output包含plugin-e2e=true`)

  // 6) 中断：等 sleep 工具真正开始再打断（插件走 agent.cancel，宿主补 turn/end aborted）
  await apiJson(`/web/sessions/${sessionId}/events`, {
    method: 'POST',
    body: JSON.stringify({ type: 'user', content: '必须用 bash 工具执行命令 `sleep 20`，命令结束后再回复我。' }),
  })
  await pollFor(
    'sleep tool started',
    async () =>
      (await history(sessionId)).find(
        (event) => event.type === 'tool_use' && JSON.stringify(event.payload?.tool_input ?? {}).includes('sleep'),
      ),
    45_000,
  )
  await apiJson(`/web/sessions/${sessionId}/interrupt`, { method: 'POST', body: JSON.stringify({}) })
  const aborted = await pollFor(
    'aborted result',
    async () =>
      (await history(sessionId)).find((event) => event.type === 'result' && event.payload?.subtype === 'aborted'),
    60_000,
  )
  const rawAborted = aborted.payload?.raw
  const abortMessage =
    (rawAborted && typeof rawAborted === 'object' ? (rawAborted as { result?: unknown }).result : undefined) ??
    aborted.payload?.result
  expectOk(abortMessage === 'Interrupted', `aborted result 消息异常: ${String(abortMessage)}`)
  say('interrupt: result=aborted result=Interrupted')

  say('E2E PASS')
}

/** 若工具轮触发了审批卡，按一次允许；没有卡就什么也不做。 */
async function maybeApprove(sessionId: string): Promise<void> {
  try {
    const card = await pollFor(
      'approval card',
      async () => (await history(sessionId)).find((event) => event.type === 'control_request'),
      20_000,
    )
    await apiJson(`/web/sessions/${sessionId}/control`, {
      method: 'POST',
      body: JSON.stringify({ type: 'permission_response', approved: true, request_id: card.payload?.request_id }),
    })
    say('tool turn: approval card approved')
  } catch {
    // 没有审批卡是正常情况（沙箱自动放行）。
  }
}

let exitCode = 0
try {
  await main()
} catch (error) {
  exitCode = 1
  process.stderr.write(`E2E FAILED: ${error instanceof Error ? error.message : String(error)}\n`)
  for (const child of children) {
    const text = tail(child)
    if (text) process.stderr.write(`--- ${child.name} tail ---\n${text}\n`)
  }
} finally {
  for (const { proc } of children) {
    try {
      proc.kill('SIGTERM')
    } catch {
      // 已退出。
    }
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500))
  for (const { proc } of children) {
    try {
      proc.kill('SIGKILL')
    } catch {
      // 已退出。
    }
  }
  rmSync(dshHome, { recursive: true, force: true })
  rmSync(workdir, { recursive: true, force: true })
}
process.exit(exitCode)
