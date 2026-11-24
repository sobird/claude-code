# dsh-rcs-plugin 环境 worker 与手动同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 dsh 插件支持 RCS 环境派发的多会话桥接，并提供 `/rcs-sync` 手动同步与 `/rcs-max-sessions` 运行时上限。

**Architecture:** RCS 仍是 id 权威。B 路径由环境 `work/poll` 派发 `cse_` 会话，桥直接用同一 id 建 dsh agent；C 路径由 dsh 会话主动创建 RCS 会话，本地 sidecar 维护 `session-* ↔ cse_*` 映射。两种路径共用参数化后的 `InProcessBridge`（持有 `rcsSessionId` 与 `agentSessionId`）。

**Tech Stack:** Bun、TypeScript、Cordis（deepseek-harness）、Hono（RCS，不改）。

**Spec:** `docs/superpowers/specs/2026-11-24-dsh-rcs-environment-bridge-design.md`

## Global Constraints

- 只改 `packages/dsh-bridge` 与 `packages/dsh-rcs-plugin`；RCS 服务端不动。
- 插件零运行时依赖：`lib/index.js` 不得出现 `@sobird/`、`@deepseek-ai/` 导入；禁止 top-level await。
- 插件只写 stderr，前缀 `[dsh-rcs-plugin]`；绝不写 stdout。
- 新增/修改注释用中文；格式沿用 oxfmt（无分号、单引号、2 空格、120 列）。
- 不用 `as`/`!` 绕过类型；需要新增类型就往 `src/types.ts` 补声明。
- 每完成一个 Task 单独提交，提交信息用 conventional commits。

## Review Focus

- work 重投递（ack 丢失）：同 `rcsSessionId` 不得起第二条桥或第二个 agent。
- 环境 secret 过期（401）：必须重注册后继续，不能停掉已有桥。
- sidecar 损坏/缺失：重建并继续，不能抛异常阻断启动。
- `maxSessions` 调低到低于存活桥数：不杀桥，只暂停 poll。
- C 路径双 id：dsh 事件按 `agentSessionId` 过滤，上报用 `rcsSessionId`，不得串号。

---

### Task 1: 桥的双 id 改造

**Files:**

- Modify: `packages/dsh-rcs-plugin/src/bridge.ts`
- Test: `packages/dsh-rcs-plugin/__tests__/bridge.test.ts`

**Interfaces:**

- Consumes: 现有 `InProcessBridge`、`startPluginBridge`。
- Produces: `PluginBridge` 增加 `readonly rcsSessionId: string` 与 `readonly agentSessionId: string`（保留 `sessionId` 作 `rcsSessionId` 的别名也可，但不再用于 dsh）；`export class InProcessBridge`（供测试与 supervisor 直接构造），构造函数变为 `(ctx, config, rcs, worker, agentSessionId: string)`。

- [ ] **Step 1: 写失败测试（不同 id 时事件路由）**

在 `__tests__/bridge.test.ts` 新增：

```ts
test('events route by agent id while posting to the rcs id', async () => {
  const rcsId = 'cse_rcs'
  const local = new FakeRcs(rcsId)
  local.start()
  const ctx = new FakeContext()
  const agentId = 'session-local'
  const worker = {
    sessionId: rcsId,
    apiBaseUrl: local.origin,
    workerJwt: 'w',
    workerEpoch: 1,
    expiresAt: Date.now() + 60_000,
  }
  const { InProcessBridge } = await import('../src/bridge')
  const dual = new InProcessBridge(
    ctx,
    config(),
    new RcsClient({ baseUrl: local.origin, apiKey: 'test-key' }),
    worker,
    agentId,
  )
  await dual.begin()
  ctx.agents.live.set(agentId, new FakeAgent(agentId))
  ctx.emitSessionEvent(agentId, { type: 'turn/end', seq: 9, data: { reason: { kind: 'completed' } } })
  await waitFor(() => local.events.find((event) => event.type === 'result'), 'result from agent id')
  ctx.emitSessionEvent(rcsId, {
    type: 'assistant/message',
    seq: 10,
    data: { message: { content: [{ type: 'text', text: 'x' }] } },
  })
  await Bun.sleep(100)
  expect(local.events.some((event) => event.type === 'assistant')).toBe(false)
  await dual.stop()
  local.stop()
})
```

`config()` 需改成接受 origin 的写法（`config(local.origin)`），避免引用外层 `rcs`。

同时把既有 `config()` 断言里的 `bridge.sessionId` 改为 `bridge.rcsSessionId`。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/dsh-rcs-plugin && bun test __tests__/bridge.test.ts -t "events route by agent id"`  
Expected: FAIL —— `InProcessBridge` 不接受第 5 个参数 / 双 id 未实现。

- [ ] **Step 3: 实现双 id**

在 `bridge.ts` 中：

- `InProcessBridge` 增加 `readonly rcsSessionId = worker.sessionId` 与 `readonly agentSessionId`；构造参数追加 `agentSessionId: string`，默认由 `startPluginBridge` 传 `worker.sessionId`。
- 所有事件/agent 操作改用 `agentSessionId`：`onSessionEvent` 的 `session.id` 比较、`onAssistantStream`/`onAgentStatus`/`onApproval`/`onQuestion` 的 `agent.id` 比较、`ensureAgent`/`createAgent` 的 `agents.get/create/resume`、`registerSession` 的 `attachSession`、`currentAgent`。
- `alwaysAllow` 键改用 `agentSessionId`。
- 上报路径（`post`、`setStatus`、心跳、SSE）继续用 `worker`，不变。
- `PluginBridge` 暴露两个 id；`startPluginBridge` 用 `worker.sessionId` 同时作为两者。

- [ ] **Step 4: 运行全部插件测试**

Run: `cd packages/dsh-rcs-plugin && bun test`  
Expected: 27 个用例全过（原 25 + 新增）。

- [ ] **Step 5: 提交**

```bash
git add packages/dsh-rcs-plugin/src/bridge.ts packages/dsh-rcs-plugin/__tests__/bridge.test.ts
git commit -m "refactor(dsh-rcs-plugin): split bridge rcs and agent session ids"
```

---

### Task 2: `RcsHttpError` 与带环境的 `createSession`

**Files:**

- Modify: `packages/dsh-bridge/src/rcs.ts`、`packages/dsh-bridge/src/core.ts`
- Test: `packages/dsh-bridge/src/__tests__/rcs.test.ts`（新建）

**Interfaces:**

- Produces:
  - `export class RcsHttpError extends Error { readonly status: number; readonly body: string }`
  - `RcsClient.createSession(title: string | undefined, environmentId?: string): Promise<string>`
  - `RcsClient.setExternalMetadata(worker: WorkerSession, metadata: Record<string, unknown>): Promise<void>`（`PUT /worker`，只带 `external_metadata`）
- `request` 对所有非 2xx 抛 `RcsHttpError`，消息格式保持 `RCS ${method} ${path} failed: ${status} ${body.slice(0,300)}`。

- [ ] **Step 1: 写失败测试**

```ts
test('non-2xx throws RcsHttpError with status', async () => {
  const rcs = new FakeRcs('cse_x')
  rcs.start()
  rcs.failCreate = true
  const client = new RcsClient({ baseUrl: rcs.origin, apiKey: 'k' })
  const error = await client.createSession(undefined).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(RcsHttpError)
  expect((error as RcsHttpError).status).toBe(500)
  rcs.stop()
})

test('createSession sends environment_id when given', async () => {
  const rcs = new FakeRcs('cse_x')
  rcs.start()
  const client = new RcsClient({ baseUrl: rcs.origin, apiKey: 'k' })
  await client.createSession('t', 'env_1')
  expect(rcs.createdSessions).toEqual([{ title: 't', environment_id: 'env_1' }])
  rcs.stop()
})

test('setExternalMetadata PUTs the blob', async () => {
  const rcs = new FakeRcs('cse_x')
  rcs.start()
  const client = new RcsClient({ baseUrl: rcs.origin, apiKey: 'k' })
  const worker = {
    sessionId: 'cse_x',
    apiBaseUrl: rcs.origin,
    workerJwt: 'w',
    workerEpoch: 1,
    expiresAt: Date.now() + 60_000,
  }
  await client.setExternalMetadata(worker, { dsh_session_id: 'session-x' })
  expect(rcs.externalMetadata).toEqual([{ dsh_session_id: 'session-x' }])
  rcs.stop()
})
```

`FakeRcs` 增加 `readonly createdSessions: Record<string, unknown>[]` 与 `readonly externalMetadata: Record<string, unknown>[]`：前者在 `POST /v1/code/sessions` 记录请求体，后者在 `PUT /v1/code/sessions/:id/worker` 记录 `body.external_metadata`。

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/dsh-bridge && bun test src/__tests__/rcs.test.ts`  
Expected: FAIL —— 无 `RcsHttpError`、`createdSessions` 不存在。

- [ ] **Step 3: 实现**

`rcs.ts`：新增导出类；`request` 的非 2xx 分支改抛它；`createSession(title, environmentId?)` 组装 `{...(title?{title}:{}), ...(environmentId?{environment_id:environmentId}:{})}`。`core.ts` 导出 `RcsHttpError`。

`fake-rcs.ts`：记录创建请求体。

- [ ] **Step 4: 运行测试**

Run: `cd packages/dsh-bridge && bun test`  
Expected: 新用例通过，既有 27 个保持绿。

- [ ] **Step 5: 提交**

```bash
git add packages/dsh-bridge/src/rcs.ts packages/dsh-bridge/src/core.ts packages/dsh-bridge/src/testing/fake-rcs.ts packages/dsh-bridge/src/__tests__/rcs.test.ts
git commit -m "feat(dsh-bridge): add typed http errors and environment-aware session creation"
```

---

### Task 3: 环境 worker 客户端

**Files:**

- Create: `packages/dsh-bridge/src/environment.ts`
- Modify: `packages/dsh-bridge/src/core.ts`、`packages/dsh-bridge/src/testing/fake-rcs.ts`
- Test: `packages/dsh-bridge/src/__tests__/environment.test.ts`

**Interfaces:**

- Produces:
  - `export interface EnvironmentRegistration { environmentId: string; environmentSecret: string }`
  - `export interface WorkItem { id: string; environmentId: string; sessionId: string; secret: string; state: string }`
  - `export class RcsEnvironmentClient { constructor(options: { baseUrl: string; apiKey: string }) }` 方法：
    `register(input: { environmentId?: string; machineName?: string; directory?: string; maxSessions?: number; workerType?: string }): Promise<EnvironmentRegistration>`
    `poll(environmentId: string, environmentSecret: string, options?: { timeoutSeconds?: number; reclaimOlderThanMs?: number; signal?: AbortSignal }): Promise<WorkItem | null>`
    `ack(environmentId: string, workId: string, token: string): Promise<void>`
    `heartbeat(environmentId: string, workId: string, token: string): Promise<void>`
    `stop(environmentId: string, workId: string, environmentSecret: string): Promise<void>`
    `reconnect(environmentId: string): Promise<void>`
    `deregister(environmentId: string): Promise<void>`（用 apiKey）
  - `export function parseWorkSecret(secret: string): { sessionIngressToken: string; apiBaseUrl: string }`
  - `export function toWorkerSession(item: WorkItem, fallbackBaseUrl: string): WorkerSession` —— `expiresAt = Date.now() + 3_600_000`（work secret 不带 TTL，过期方向由 401 换票兜底）。

- [ ] **Step 1: 写失败测试**

```ts
test('register sends the environment payload', async () => {
  const env = new RcsEnvironmentClient({ baseUrl: rcs.origin, apiKey: 'k' })
  const result = await env.register({ machineName: 'm', directory: '/w', maxSessions: 4, workerType: 'deepseek' })
  expect(result.environmentId).toBe('env_test')
  expect(rcs.environmentRegistrations[0]).toMatchObject({
    machine_name: 'm',
    directory: '/w',
    max_sessions: 4,
    metadata: { worker_type: 'deepseek' },
  })
})

test('poll returns null on 204 and a work item otherwise', async () => {
  const env = new RcsEnvironmentClient({ baseUrl: rcs.origin, apiKey: 'k' })
  expect(await env.poll('env_test', 'es')).toBeNull()
  rcs.enqueueWork('cse_x')
  const item = await env.poll('env_test', 'es')
  expect(item).toMatchObject({ sessionId: 'cse_x' })
  const parsed = parseWorkSecret(item!.secret)
  expect(parsed.sessionIngressToken).toBe('work-jwt')
  expect(toWorkerSession(item!, rcs.origin).sessionId).toBe('cse_x')
})
```

`FakeRcs` 增加：`environmentRegistrations: Record<string, unknown>[]`、`enqueueWork(sessionId)`、
`nextPollStatus: number | null`（非空时 poll 返回该状态码并清空）、
`GET /v1/environments/:id/work/poll`（队列空 → 204，否则取出一条，secret 为
`base64url({version:1,session_ingress_token:'work-jwt',api_base_url:origin,...})`）、
`ack/stop/heartbeat` 记录集合、`DELETE /v1/environments/bridge/:id`、
`POST /v1/environments/:id/bridge/reconnect` 记录调用。

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/dsh-bridge && bun test src/__tests__/environment.test.ts`  
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 `environment.ts`**

按 Interfaces 实现，复用 `RcsHttpError`；`poll` 带 `timeout`（秒）与 `reclaim_older_than_ms` 查询参数，204 返回 `null`。`core.ts` 导出上述 API。

- [ ] **Step 4: 运行测试**

Run: `cd packages/dsh-bridge && bun test`  
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add packages/dsh-bridge/src/environment.ts packages/dsh-bridge/src/core.ts packages/dsh-bridge/src/testing/fake-rcs.ts packages/dsh-bridge/src/__tests__/environment.test.ts
git commit -m "feat(dsh-bridge): add rcs environment worker client"
```

---

### Task 4: 插件配置与本地状态目录

**Files:**

- Modify: `packages/dsh-rcs-plugin/src/config.ts`
- Create: `packages/dsh-rcs-plugin/src/environment-state.ts`
- Test: `packages/dsh-rcs-plugin/__tests__/config.test.ts`（新建）、`__tests__/environment-state.test.ts`（新建）

**Interfaces:**

- Produces:
  - `export type BridgeMode = 'single' | 'environment'`
  - `ResolvedConfig` 增加 `mode: BridgeMode`、`environmentId: string | undefined`、`maxSessions: number`
  - `export function bridgeStateDir(env?: Record<string, string | undefined>): string` —— `path.join(env.DSH_HOME ?? path.join(os.homedir(), '.dsh'), 'rcs-bridge')`
  - `export async function readEnvironmentId(dir: string): Promise<string | undefined>`
  - `export async function writeEnvironmentId(dir: string, environmentId: string): Promise<void>` —— 原子写 `environment.json`，mode `0o600`，内容 `{ version: 1, environmentId }`。

- [ ] **Step 1: 写失败测试**

```ts
expect(resolveConfig({ apiKey: 'k' }).mode).toBe('single')
expect(resolveConfig({ apiKey: 'k' }, { RCS_BRIDGE_MODE: 'environment', RCS_MAX_SESSIONS: '6' })).toMatchObject({
  mode: 'environment',
  maxSessions: 6,
})
expect(() => resolveConfig({ apiKey: 'k' }, { RCS_BRIDGE_MODE: 'weird' })).toThrow(/mode/)
expect(() => resolveConfig({ apiKey: 'k' }, { RCS_MAX_SESSIONS: '0' })).toThrow(/maxSessions/)
```

state 测试用 `mkdtemp`：写入后读取一致；文件权限为 `0o600`。

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/dsh-rcs-plugin && bun test __tests__/config.test.ts __tests__/environment-state.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现**

`config.ts` 增加三个字段的解析（config > env > 默认；`maxSessions` 默认 4，必须是正整数）。`environment-state.ts` 用 `node:fs/promises` 的 `writeFile(tmp)` + `rename`，父目录 `mkdir({ recursive: true, mode: 0o700 })`。

- [ ] **Step 4: 运行测试**

Run: `cd packages/dsh-rcs-plugin && bun test`  
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add packages/dsh-rcs-plugin/src/config.ts packages/dsh-rcs-plugin/src/environment-state.ts packages/dsh-rcs-plugin/__tests__/config.test.ts packages/dsh-rcs-plugin/__tests__/environment-state.test.ts
git commit -m "feat(dsh-rcs-plugin): add environment mode config and state directory"
```

---

### Task 5: sidecar 与 supervisor

**Files:**

- Create: `packages/dsh-rcs-plugin/src/sidecar.ts`、`packages/dsh-rcs-plugin/src/supervisor.ts`
- Modify: `packages/dsh-rcs-plugin/src/index.ts`、`packages/dsh-rcs-plugin/src/bridge.ts`
- Test: `packages/dsh-rcs-plugin/__tests__/sidecar.test.ts`、`__tests__/supervisor.test.ts`（新建）

**Interfaces:**

- Produces:
  - `sidecar.ts`：
    `export interface SidecarEntry { rcsSessionId: string; syncedAt: string }`
    `readSidecar(dir): Promise<Record<string, SidecarEntry>>`、`writeSidecar(dir, map)`、`recordSync(dir, dshSessionId, rcsSessionId)`、`agentIdForRcs(map, rcsSessionId): string | undefined`、`rcsIdForAgent(map, dshSessionId): string | undefined`
    文件 `sessions.json`：`{ version: 1, sessions: Record<dshId, SidecarEntry> }`；解析失败时把原文件改名为 `.bak` 后返回 `{}`。
  - `supervisor.ts`：
    `export interface SessionSupervisor { readonly environmentId: string; bridgeIds(): readonly string[]; attach(rcsSessionId: string, agentSessionId: string, worker?: WorkerSession): Promise<PluginBridge>; setMaxSessions(limit: number): Promise<void>; dispose(): Promise<void> }`
    `export async function startSupervisor(ctx: PluginContextLike, config: ResolvedConfig, options?: { emptyPollDelayMs?: number }): Promise<SessionSupervisor>`
    `attach` 对已存在的 `rcsSessionId` 直接返回现有桥（幂等）；给了 `worker` 就不再 `openWorker`。
  - `bridge.ts`：`InProcessBridge` 构造参数追加可选 `hooks?: { onGone?: () => void }`；`setStatus`/`post` 捕获 `RcsHttpError(404)` 时调用一次 `onGone`（用于 RCS 删除会话后停桥）。
- Consumes: Task 1 双 id 桥、Task 2 `RcsHttpError`、Task 3 环境客户端、Task 4 配置与状态目录、Task 4 `writeEnvironmentId`。

- [ ] **Step 1: 写失败测试（supervisor 派发）**

```ts
test('a work item starts one bridge and acks it', async () => {
  const ctx = new FakeContext()
  const supervisor = await startSupervisor(ctx, envConfig(), { emptyPollDelayMs: 20 })
  rcs.enqueueWork('cse_a')
  await waitFor(() => (supervisor.bridgeIds().includes('cse_a') ? true : undefined), 'bridge start')
  expect(rcs.acked).toHaveLength(1)
  await waitFor(() => (rcs.statuses.some((s) => s.status === 'idle') ? true : undefined), 'idle status')
})

test('duplicate delivery does not create a second bridge', async () => {
  const supervisor = await startSupervisor(new FakeContext(), envConfig(), { emptyPollDelayMs: 20 })
  rcs.enqueueWork('cse_a')
  rcs.enqueueWork('cse_a')
  await waitFor(() => (supervisor.bridgeIds().length === 1 ? true : undefined), 'single bridge')
  await Bun.sleep(100)
  expect(supervisor.bridgeIds()).toEqual(['cse_a'])
})

test('a 401 during poll re-registers and keeps working', async () => {
  const supervisor = await startSupervisor(new FakeContext(), envConfig(), { emptyPollDelayMs: 20 })
  rcs.nextPollStatus = 401
  await waitFor(() => (rcs.environmentRegistrations.length >= 2 ? true : undefined), 're-register')
  rcs.enqueueWork('cse_b')
  await waitFor(() => (supervisor.bridgeIds().includes('cse_b') ? true : undefined), 'work after re-register')
})
```

sidecar 测试：写入后读取一致；`sessions.json` 为无效 JSON 时 `readSidecar` 返回 `{}` 并生成 `sessions.json.bak`。

`FakeRcs.nextPollStatus` 由 Task 3 提供；本任务用它模拟 401。`envConfig()` 返回 `{...config(), mode:'environment', environmentId: undefined, maxSessions: 2}`。

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/dsh-rcs-plugin && bun test __tests__/supervisor.test.ts`  
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 sidecar 与 supervisor**

`startSupervisor` 流程：`RcsEnvironmentClient.register`（`machineName: os.hostname()`、`directory: config.workdir`、`maxSessions`、`workerType: 'deepseek'`，带 `config.environmentId`）→ `writeEnvironmentId` → `reconnect`（失败只记日志）→ 循环：

- `bridgeIds().length >= maxSessions` 时 sleep `emptyPollDelayMs` 后重查（暂停 poll）。
- `poll` 204 → sleep `emptyPollDelayMs` 继续。
- 收到 work → `ack` → `toWorkerSession` → 若已存在则跳过 → 用 sidecar 反查 `agentSessionId`（未命中则等于 `rcsSessionId`）→ `new InProcessBridge(..., agentSessionId)` + `begin()` → 入表。
- 捕获 `RcsHttpError`：poll 401 → 重新 `register`（带当前 `environmentId`）并替换 secret 后继续，注册本身失败则退避 1 秒重试；work/attach 404 → 跳过该条。
- 起桥时传 `hooks: { onGone: () => this.remove(rcsId) }`；`remove` 会 `stop()` 对应桥并从表里删除（RCS 删会话后释放槽位）。
- `dispose()`：停止循环 → 停所有桥 → `deregister`。
- `attach(rcsId, agentId, worker?)`：已存在返回；否则用传入 `worker` 或 `openWorker(rcsId)` 起桥入表，不受上限阻塞（超限只记日志）。

`index.ts`：`config.mode === 'environment'` 时 `startSupervisor`，日志 `attached to ... environment <id>`，`ctx.effect(() => () => supervisor.dispose())`；`single` 保持现状。

- [ ] **Step 4: 运行测试**

Run: `cd packages/dsh-rcs-plugin && bun test`  
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add packages/dsh-rcs-plugin/src/sidecar.ts packages/dsh-rcs-plugin/src/supervisor.ts packages/dsh-rcs-plugin/src/index.ts packages/dsh-rcs-plugin/__tests__/sidecar.test.ts packages/dsh-rcs-plugin/__tests__/supervisor.test.ts
git commit -m "feat(dsh-rcs-plugin): supervise rcs environments and dispatch work"
```

---

### Task 6: `/rcs-max-sessions`

**Files:**

- Create: `packages/dsh-rcs-plugin/src/commands.ts`
- Modify: `packages/dsh-rcs-plugin/src/types.ts`、`packages/dsh-rcs-plugin/src/index.ts`
- Test: `packages/dsh-rcs-plugin/__tests__/commands.test.ts`（新建）

**Interfaces:**

- Produces in `types.ts`：
  `export interface CommandInvocationLike { readonly agent?: { readonly id: string }; readonly rawInput: string }`
  `export type CommandResultLike = { kind: 'success'; text?: string } | { kind: 'error'; text: string }`
  `export interface CommandsServiceLike { register(definition: { name: string; description: string; handler: (invocation: CommandInvocationLike) => CommandResultLike | Promise<CommandResultLike> }): unknown }`
  `export function isCommands(value: unknown): value is CommandsServiceLike`
- `commands.ts`：
  `export async function runMaxSessionsCommand(supervisor: SessionSupervisor, rawInput: string): Promise<CommandResultLike>`
  `export function registerCommands(ctx: PluginContextLike, deps: { supervisor: SessionSupervisor; config: ResolvedConfig }): void`
  仅当 `ctx.get('commands')` 通过 `isCommands` 时注册；命令名 `rcs-max-sessions`（调用形式 `/rcs-max-sessions 6`），handler 调 `runMaxSessionsCommand`。

- [ ] **Step 1: 写失败测试**

```ts
test('rejects a non-positive limit without changing state', async () => {
  const result = await runMaxSessionsCommand(supervisor, '0')
  expect(result.kind).toBe('error')
  expect(supervisor.bridgeIds()).toEqual([])
})

test('a valid limit re-registers the environment', async () => {
  expect((await runMaxSessionsCommand(supervisor, ' 6 ')).kind).toBe('success')
  expect(rcs.environmentRegistrations.at(-1)).toMatchObject({ max_sessions: 6 })
})

test('lowering below live bridges keeps them', async () => {
  rcs.enqueueWork('cse_a')
  await waitFor(() => (supervisor.bridgeIds().length === 1 ? true : undefined), 'bridge start')
  expect((await runMaxSessionsCommand(supervisor, '1')).kind).toBe('success')
  expect(supervisor.bridgeIds()).toEqual(['cse_a'])
})
```

`FakeContext` 增加 `commands` 支持：`provide('commands', fake)` 即可；注册测试抓取 definition 并调用 handler。

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/dsh-rcs-plugin && bun test __tests__/commands.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现**

`supervisor.setMaxSessions(limit)`：校验正整数（内部也校验），更新字段，重新 `register`（同一 `environmentId`，新 `maxSessions`）并替换 secret；不停止任何桥。`single` 模式下命令不存在（不注册）。

- [ ] **Step 4: 运行测试**

Run: `cd packages/dsh-rcs-plugin && bun test`  
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add packages/dsh-rcs-plugin/src/commands.ts packages/dsh-rcs-plugin/src/types.ts packages/dsh-rcs-plugin/src/index.ts packages/dsh-rcs-plugin/__tests__/commands.test.ts
git commit -m "feat(dsh-rcs-plugin): allow changing max sessions at runtime"
```

---

### Task 7: `/rcs-sync` 手动同步

**Files:**

- Modify: `packages/dsh-rcs-plugin/src/commands.ts`、`packages/dsh-rcs-plugin/src/types.ts`
- Create: `packages/dsh-rcs-plugin/src/sync.ts`
- Test: `packages/dsh-rcs-plugin/__tests__/sync.test.ts`（新建）

**Interfaces:**

- Produces:
  `export async function syncSession(deps: { ctx: PluginContextLike; supervisor: SessionSupervisor; config: ResolvedConfig; rcs: RcsClient }, agentSessionId: string): Promise<CommandResultLike>`
  `commands.ts` 在 `sync` 模式下注册 `rcs-sync`，handler 调 `syncSession(..., invocation.agent.id)`。
- Consumes: Task 2 `createSession(title, environmentId)`、Task 5 `recordSync`/`rcsIdForAgent`/`supervisor.attach`、现有 `RcsClient.openWorker`。

- [ ] **Step 1: 写失败测试**

```ts
test('syncs a dsh session and is idempotent', async () => {
  ctx.agents.live.set('session-local', new FakeAgent('session-local'))
  const first = await syncSession(deps, 'session-local')
  expect(first.kind).toBe('success')
  expect(rcs.createdSessions).toHaveLength(1)
  expect(rcs.createdSessions[0]).toMatchObject({ environment_id: 'env_test', title: 'session-local' })
  expect(supervisor.bridgeIds()).toContain('cse_test')
  const second = await syncSession(deps, 'session-local')
  expect(second.kind).toBe('success')
  expect(rcs.createdSessions).toHaveLength(1)
})

test('routes dsh events through the agent id, not the rcs id', async () => {
  await syncSession(deps, 'session-local')
  ctx.emitSessionEvent('session-local', {
    type: 'assistant/message',
    seq: 1,
    data: { message: { content: [{ type: 'text', text: 'hi' }] } },
  })
  await waitFor(() => rcs.events.find((e) => e.type === 'assistant'), 'assistant event')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/dsh-rcs-plugin && bun test __tests__/sync.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 `sync.ts`**

顺序：agent id 缺失 → error；以 `cse_` 开头 → success「已在 RCS」；sidecar 反查命中 → success；标题取 `ctx.get('sessionQuery')` 列表里 `header.id === agentSessionId` 的 `header.title`（字符串时），否则用 agent id；`rcs.createSession(title, supervisor.environmentId)`；`worker = await rcs.openWorker(rcsId)`；`supervisor.attach(rcsId, agentSessionId, worker)`；`recordSync(stateDir, agentSessionId, rcsId)`；`setExternalMetadata(worker, { dsh_session_id: agentSessionId })`（失败只记日志）；返回 success 文本（含 rcsId 与「历史不会同步」提示）。`createSession`/`attach` 失败 → error 文本，且不写 sidecar（先 attach 成功再写记录）。

- [ ] **Step 4: 运行测试**

Run: `cd packages/dsh-rcs-plugin && bun test`  
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add packages/dsh-rcs-plugin/src/commands.ts packages/dsh-rcs-plugin/src/types.ts packages/dsh-rcs-plugin/src/sync.ts packages/dsh-rcs-plugin/__tests__/sync.test.ts
git commit -m "feat(dsh-rcs-plugin): sync a local dsh session to rcs on demand"
```

---

### Task 8: 文档与门禁

**Files:**

- Modify: `packages/dsh-rcs-plugin/README.md`、`packages/dsh-bridge/README.md`（各加一行设计链接）
- Test: 全量门禁

- [ ] **Step 1: 更新 README**

插件 README：配置表加 `mode`/`environmentId`/`maxSessions`；行为小节加环境派发、`/rcs-sync`（不回填历史）、`/rcs-max-sessions`；已知限制加 sidecar 位置、单机假设、C 会话重启靠 reconnect。桥 README 加环境客户端与新导出。两处都链接
`docs/superpowers/specs/2026-11-24-dsh-rcs-environment-bridge-design.md`。

- [ ] **Step 2: 跑门禁**

```bash
cd packages/dsh-bridge && bun test && bun run typecheck
cd ../dsh-rcs-plugin && bun test && bun run typecheck && bun run build
cd ../.. && bun run fmt:check && bun run lint && bun test
```

Expected: 全绿；`packages/dsh-rcs-plugin/lib/index.js` 不含 `@sobird/`、`@deepseek-ai/` 运行时导入。

- [ ] **Step 3: 手动验收（真实 web profile，可延后）**

`bun run build` 后用绝对路径装进 web profile，配 `mode: environment`，启动 dsh 并确认：
RCS 环境列表出现本机环境 → Web 新建会话 → 完成一轮 → interrupt 生效；
`/rcs-sync` 能同步一条既有 dsh 会话且重复执行不再新建；`/rcs-max-sessions 2` 后
容量显示更新、调高能领到新会话。

- [ ] **Step 4: 提交**

```bash
git add packages/dsh-rcs-plugin/README.md packages/dsh-bridge/README.md
git commit -m "docs(dsh-rcs-plugin): document environment worker mode and sync commands"
```
