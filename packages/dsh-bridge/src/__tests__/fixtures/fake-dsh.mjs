// 轻量 dsh 替身：只说 SDK profile 的 JSON-RPC 子集，按 prompt 文本挑选场景。
// 事件/请求都写进 FAKE_DSH_LOG，供测试进程断言「桥把什么传给了 dsh」。
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const logFile = process.env.FAKE_DSH_LOG

function log(entry) {
  if (logFile) appendFileSync(logFile, `${JSON.stringify(entry)}\n`)
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params })
}

let seq = 0
let sessionId = ''
let serverSeq = 0
const pendingServer = new Map()

function event(type, data) {
  seq += 1
  notify('session.event', { sessionId, event: { type, seq, time: Date.now(), data } })
}

/** 反向请求宿主（审批/提问），等宿主回 result 后 resolve。 */
function hostRequest(method, params) {
  return new Promise((resolve) => {
    const id = `srv_${(serverSeq += 1)}`
    pendingServer.set(id, resolve)
    send({ jsonrpc: '2.0', id, method, params })
  })
}

function textOf(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text)
    .join('')
}

async function runTurn(text) {
  event('turn/start', { turn: 1 })

  if (text.includes('approval')) {
    const outcome = await hostRequest('approval/request', {
      sessionId,
      toolName: 'bash',
      callId: 'call_approval',
      reason: 'fake approval request',
    })
    log({ kind: 'approval-outcome', outcome: outcome?.outcome ?? null })
    event('turn/end', { turn: 1, reason: { kind: 'completed' } })
    return
  }

  if (text.includes('question')) {
    const answer = await hostRequest('user-question/ask', {
      requestId: 'native_q1',
      sessionId,
      questions: [
        {
          id: 'plan-review',
          question: 'Approve this plan?',
          options: [{ label: 'Approve' }, { label: 'Revise' }],
          detail: '# Plan\n\n1. fake step',
          intent: { kind: 'plan-review', approve: 'Approve' },
        },
      ],
    })
    log({ kind: 'question-answer', answer })
    event('turn/end', { turn: 1, reason: { kind: 'completed' } })
    return
  }

  if (text.includes('slow')) {
    // 永不结束：留给 interrupt 场景，等桥杀进程组。
    return
  }

  event('assistant/message', {
    turn: 1,
    step: 1,
    message: { role: 'assistant', content: [{ type: 'text', text: 'hello from fake dsh' }] },
  })
  event('tool/call', {
    turn: 1,
    step: 1,
    callId: 'call_1',
    name: 'bash',
    arguments: JSON.stringify({ command: 'echo hi' }),
  })
  event('tool/result', {
    turn: 1,
    step: 1,
    message: { role: 'tool', toolCallId: 'call_1', content: [{ type: 'text', text: 'hi' }] },
  })
  event('turn/end', { turn: 1, reason: { kind: 'completed' } })
}

const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (!message || typeof message !== 'object') return

  // 宿主对反向请求的答复（无 method，只有 id）。
  if (message.id !== undefined && message.method === undefined) {
    const resolve = pendingServer.get(message.id)
    if (resolve) {
      pendingServer.delete(message.id)
      log({ kind: 'server-response', id: message.id, result: message.result ?? null })
      resolve(message.result)
    }
    return
  }

  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: {} })
    return
  }
  if (message.method === 'session/resume') {
    log({ kind: 'resume', sessionId: message.params?.sessionId ?? null })
    send({ jsonrpc: '2.0', id: message.id, result: {} })
    return
  }
  if (message.method === 'session/prompt') {
    sessionId = message.params?.sessionId || sessionId
    const text = textOf(message.params?.contentBlocks)
    log({ kind: 'prompt', text, sessionId })
    send({ jsonrpc: '2.0', id: message.id, result: { messageId: `m_${Date.now()}` } })
    void runTurn(text)
    return
  }
  if (message.method === 'shutdown') {
    send({ jsonrpc: '2.0', id: message.id, result: {} })
    process.exit(0)
  }
})
