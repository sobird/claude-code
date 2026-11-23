/**
 * 工具卡片视图的端到端用例。
 *
 * 走完整条真实链路：CLI 侧 WebSocket 接入（鉴权、持久化、扇出）→ Web 会话 SSE
 * 流（真实 HTTP 帧）→ 客户端 SSE 解析 → 会话 reducer → 卡片视图分发。
 * 唯一未覆盖的是 JSX 渲染本身——RCS 有意不引入 DOM 测试环境，因此这里改用
 * 每个视图的模型函数断言“用户最终会看到的内容”。
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { Hono } from 'hono'

process.env.RCS_AUTH_SECRET = 'test-secret'
process.env.RCS_API_KEYS = 'test-api-key'

import type { AppEnv } from '@/auth/context'
import { encodeWebSocketAuthProtocol } from '@/auth/context'
import { signAccessToken } from '@/auth/tokens'
import { backgroundTaskViewModel } from '@/components/chat/tool-views/background-task-model'
import { bashViewModel } from '@/components/chat/tool-views/bash-model'
import { fileViewModel } from '@/components/chat/tool-views/file-model'
import { mcpViewModel } from '@/components/chat/tool-views/mcp-model'
import { messageViewModel } from '@/components/chat/tool-views/message-model'
import { toolViewKind } from '@/components/chat/tool-views/registry'
import { searchViewModel } from '@/components/chat/tool-views/search-model'
import { skillViewModel } from '@/components/chat/tool-views/skill-model'
import { safeHttpUrl, webViewModel } from '@/components/chat/tool-views/web-model'
import type { Repositories } from '@/db/repositories/types'
import { createTestRepositories } from '@/db/testing'
import { applyHistory, initialChatState, type SessionEventInput, type ToolCallData } from '@/lib/session-reducer'
import { consumeSse } from '@/lib/sse-client'
import { diffLines } from '@/lib/text-diff'
import sessionIngress, { websocket as sessionIngressWebsocket } from '@/routes/v1/session-ingress'
import webSessions from '@/routes/web/sessions'
import { getAllEventBuses, removeEventBus } from '@/transport/event-bus'

interface FrameData {
  type?: unknown
  payload?: unknown
  direction?: unknown
  seqNum?: unknown
}

/** `useSessionStream` 的帧到事件映射（该函数未导出），只保留断言需要的字段。 */
function toEventInput(data: string): SessionEventInput | null {
  let parsed: FrameData
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  if (typeof parsed.type !== 'string' || typeof parsed.seqNum !== 'number') return null
  return {
    type: parsed.type,
    payload: parsed.payload,
    seqNum: parsed.seqNum,
    direction: parsed.direction === 'outbound' ? 'outbound' : 'inbound',
  }
}

function createApp(repos: Repositories) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('repos', repos)
    await next()
  })
  app.route('/v2/session_ingress', sessionIngress)
  app.route('/web', webSessions)
  return app
}

/** CLI 会发出的一轮工具调用：assistant 消息携带 tool_use，合成 user 消息携带 tool_result。 */
const ASSISTANT_TOOL_USE = {
  type: 'assistant',
  uuid: 'asst_1',
  message: {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'call_bash',
        name: 'Bash',
        input: { command: 'ls -la', description: 'List files' },
      },
      {
        type: 'tool_use',
        id: 'call_edit',
        name: 'Edit',
        input: { file_path: '/repo/a.ts', old_string: 'let a = 1', new_string: 'let a = 2' },
      },
      {
        type: 'tool_use',
        id: 'call_grep',
        name: 'Grep',
        input: { pattern: 'TODO', path: 'src' },
      },
      {
        type: 'tool_use',
        id: 'call_web',
        name: 'WebFetch',
        input: { url: 'https://example.com' },
      },
    ],
  },
}

const USER_TOOL_RESULT = {
  type: 'user',
  uuid: 'user_1',
  message: {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'call_bash', content: 'a.txt\nb.txt' },
      { type: 'tool_result', tool_use_id: 'call_edit', content: 'Edited' },
      { type: 'tool_result', tool_use_id: 'call_grep', content: 'src/a.ts:1: // TODO' },
      { type: 'tool_result', tool_use_id: 'call_web', content: 'Example Domain' },
    ],
  },
}

/** 一轮 WS 工具调用 + 结果：assistant 携带 tool_use，合成 user 携带 tool_result。 */
const LATE_ASSISTANT = {
  type: 'assistant',
  uuid: 'asst_2',
  message: {
    role: 'assistant',
    content: [
      { type: 'tool_use', id: 'call_task_output', name: 'TaskOutput', input: { task_id: 'bash_1' } },
      { type: 'tool_use', id: 'call_skill', name: 'Skill', input: { skill: 'commit', args: '--amend' } },
      {
        type: 'tool_use',
        id: 'call_brief',
        name: 'Brief',
        input: { message: 'Deploy is live', attachments: ['/a.png'], status: 'proactive' },
      },
      { type: 'tool_use', id: 'call_mcp_echo', name: 'mcp__demo__echo', input: { text: 'hi' } },
    ],
  },
}

const LATE_RESULTS = {
  type: 'user',
  uuid: 'user_2',
  message: {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'call_task_output',
        content:
          '<retrieval_status>success</retrieval_status>\n<task_id>bash_1</task_id>\n<task_type>local_bash</task_type>\n<status>completed</status>\n<exit_code>0</exit_code>\n<output>done</output>',
      },
      {
        type: 'tool_result',
        tool_use_id: 'call_skill',
        content: 'Skill "commit" completed (forked execution).\n\nResult:\nDone',
      },
      {
        type: 'tool_result',
        tool_use_id: 'call_brief',
        content: 'Message delivered to user. (1 attachments included)',
      },
      { type: 'tool_result', tool_use_id: 'call_mcp_echo', content: 'hi' },
    ],
  },
}

let repos: Repositories
let app: Hono<AppEnv>
let server: ReturnType<typeof Bun.serve>
let adminToken: string
let base: string

beforeEach(async () => {
  for (const [key] of getAllEventBuses()) removeEventBus(key)
  repos = await createTestRepositories()
  const admin = await repos.users.create({ username: 'admin', passwordHash: 'hash', role: 'admin' })
  adminToken = await signAccessToken({ id: admin.id, username: admin.username, role: admin.role })
  app = createApp(repos)
  server = Bun.serve({
    port: 0,
    fetch: app.fetch,
    websocket: { ...sessionIngressWebsocket, idleTimeout: 30 },
  })
  base = `http://127.0.0.1:${server.port}`
})

afterEach(async () => {
  await server.stop(true)
  for (const [key] of getAllEventBuses()) removeEventBus(key)
})

/**
 * 一轮真实的 WS → 持久化 → SSE 回环：CLI 侧接入发送事件，Web 端订阅真实 SSE 流，
 * 客户端 reducer 折叠后返回本次的工具调用。
 */
async function roundTrip(events: Array<{ type: string } & Record<string, unknown>>): Promise<ToolCallData[]> {
  const session = await repos.sessions.create({})

  // 1. Web 端先订阅真实 SSE 流；fetch 返回即代表服务端订阅已建立。
  const controller = new AbortController()
  const response = await fetch(`${base}/web/sessions/${session.id}/events`, {
    headers: { Authorization: `Bearer ${adminToken}`, Accept: 'text/event-stream' },
    signal: controller.signal,
  })
  expect(response.status).toBe(200)

  const received: SessionEventInput[] = []
  const readLoop = consumeSse(
    response,
    (frame) => {
      const event = toEventInput(frame.data)
      if (!event) return
      received.push(event)
      if (received.length >= events.length) controller.abort()
    },
    controller.signal,
  ).catch(() => {
    // 收满帧后主动 abort，读取循环以 AbortError 结束。
  })

  // 2. CLI 侧通过真实 WebSocket 接入发送事件。
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/v2/session_ingress/ws/${session.id}`, [
    encodeWebSocketAuthProtocol('test-api-key'),
  ])
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('websocket open timed out')), 3000)
    ws.addEventListener('open', () => {
      clearTimeout(timeout)
      for (const message of events) ws.send(`${JSON.stringify(message)}\n`)
      resolve()
    })
    ws.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error('websocket connection failed'))
    })
  })

  const deadline = Date.now() + 5000
  while (received.length < events.length && Date.now() < deadline) await Bun.sleep(10)
  ws.close()
  controller.abort()
  await readLoop

  // 3. 真实 SSE 帧经客户端 reducer 折叠成聊天状态。
  expect(received.map((event) => event.type)).toEqual(events.map((event) => event.type))
  const state = applyHistory(initialChatState, received)
  return state.entries.flatMap((entry) => (entry.type === 'tool_call' ? [entry.toolCall] : []))
}

describe('tool card views end to end', () => {
  test('a CLI tool round trip reaches the chat state and selects the matching views', async () => {
    const calls = await roundTrip([ASSISTANT_TOOL_USE, USER_TOOL_RESULT])

    expect(calls.map((call) => call.title)).toEqual(['Bash', 'Edit', 'Grep', 'WebFetch'])
    expect(calls.map((call) => call.status)).toEqual(['complete', 'complete', 'complete', 'complete'])
    const [bashCall, fileCall, searchCall, webCall] = calls
    if (!bashCall || !fileCall || !searchCall || !webCall) throw new Error('expected four tool calls')

    // 4. 卡片按工具名选中视图族。
    expect(calls.map((call) => toolViewKind(call.title))).toEqual(['bash', 'file', 'search', 'web'])

    // 5. 各视图模型解析出用户最终看到的命令、差异、结果与链接。
    const bash = bashViewModel(bashCall)
    expect(bash?.command).toBe('ls -la')
    expect(bash?.description).toBe('List files')
    expect(bash?.output).toBe('a.txt\nb.txt')

    const file = fileViewModel(fileCall)
    expect(file?.path).toBe('/repo/a.ts')
    const hunk = file?.hunks?.[0]
    if (!hunk) throw new Error('expected an Edit diff hunk')
    expect(diffLines(hunk.before, hunk.after)).toEqual([
      { type: 'remove', text: 'let a = 1' },
      { type: 'add', text: 'let a = 2' },
    ])

    const search = searchViewModel(searchCall)
    expect(search?.pattern).toBe('TODO')
    expect(search?.path).toBe('src')
    expect(search?.output).toBe('src/a.ts:1: // TODO')

    const web = webViewModel(webCall)
    expect(web?.url).toBe('https://example.com')
    expect(safeHttpUrl(web?.url ?? '')).toBe('https://example.com')
    expect(web?.output).toBe('Example Domain')
  }, 10000)

  test('covers the background, skill, message, and MCP cards', async () => {
    const calls = await roundTrip([LATE_ASSISTANT, LATE_RESULTS])

    expect(calls.map((call) => call.title)).toEqual(['TaskOutput', 'Skill', 'Brief', 'mcp__demo__echo'])
    expect(calls.map((call) => toolViewKind(call.title))).toEqual(['background', 'skill', 'message', 'mcp'])
    const [taskCall, skillCall, briefCall, mcpCall] = calls
    if (!taskCall || !skillCall || !briefCall || !mcpCall) throw new Error('expected four tool calls')

    const task = backgroundTaskViewModel(taskCall)
    expect(task).toMatchObject({
      kind: 'output',
      taskId: 'bash_1',
      status: 'completed',
      exitCode: 0,
      output: 'done',
    })

    const skill = skillViewModel(skillCall)
    expect(skill).toEqual({ name: 'commit', args: '--amend', forked: true, result: 'Done' })

    const brief = messageViewModel(briefCall)
    expect(brief).toEqual({ kind: 'brief', message: 'Deploy is live', attachments: 1, delivered: true })

    const mcp = mcpViewModel(mcpCall)
    expect(mcp).toMatchObject({
      server: 'demo',
      tool: 'echo',
      input: [{ key: 'text', value: 'hi' }],
      output: 'hi',
      errored: false,
    })
  }, 10000)
})
