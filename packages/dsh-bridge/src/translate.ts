import { asArray, asText, isRecord } from './util'

/** 一条要 POST 给 RCS 的事件；`type` 对应 session_events.event_type。 */
export interface RcsEvent {
  type: string
  payload: Record<string, unknown>
}

/** dsh 的 `session.event` 通知载荷；只取翻译需要的字段。 */
export interface DshSessionEvent {
  type: string
  seq: number
  data: Record<string, unknown>
}

/** dsh `session/prompt` 能接受的内容块子集。 */
export type DshPromptBlock = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function recordOf(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

/** 拼接内容块里的文本（忽略非文本块）。 */
function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    const block = recordOf(item)
    if (block?.type === 'text') parts.push(asText(block.text))
  }
  return parts.join('')
}

/** 从 `{role, content}` 消息或载荷顶层取内容。 */
function contentOf(record: Record<string, unknown>): unknown {
  const message = recordOf(record.message)
  if (message && 'content' in message) return message.content
  return record.content
}

/** 把 RCS 入站用户载荷转成 dsh 提示块；图片仅接收网关水合后的 base64 块。 */
export function promptBlocks(payload: Record<string, unknown>): DshPromptBlock[] {
  const content = contentOf(payload)
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  if (!Array.isArray(content)) return []

  const blocks: DshPromptBlock[] = []
  for (const item of content) {
    const block = recordOf(item)
    if (!block) continue
    if (block.type === 'text') {
      const text = asText(block.text)
      if (text) blocks.push({ type: 'text', text })
      continue
    }
    if (block.type !== 'image') continue
    const source = recordOf(block.source)
    const mediaType = asText(source?.media_type)
    const data = asText(source?.data)
    if (source?.type === 'base64' && IMAGE_MIME_TYPES.has(mediaType) && data) {
      blocks.push({ type: 'image', data, mimeType: mediaType })
    }
  }
  return blocks
}

function assistantEvent(event: DshSessionEvent): RcsEvent | null {
  const message = recordOf(event.data.message)
  const text = message ? textOfContent(message.content) : ''
  if (!text) return null
  return {
    type: 'assistant',
    payload: {
      type: 'assistant',
      uuid: `dsh-a-${event.seq}`,
      message: { role: 'assistant', content: [{ type: 'text', text }] },
    },
  }
}

function toolCallEvent(event: DshSessionEvent): RcsEvent | null {
  const callId = asText(event.data.callId)
  const name = asText(event.data.name)
  if (!callId || !name) return null
  return {
    type: 'tool_use',
    payload: {
      type: 'tool_use',
      tool_call_id: callId,
      tool_name: name,
      tool_input: parseArguments(event.data.arguments),
    },
  }
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return recordOf(parsed) ?? {}
  } catch {
    return {}
  }
}

function toolResultEvent(event: DshSessionEvent): RcsEvent | null {
  const message = recordOf(event.data.message)
  const callId = asText(message?.toolCallId)
  if (!message || !callId) return null
  const text = textOfContent(message.content)
  return {
    type: 'user',
    payload: {
      type: 'user',
      uuid: `dsh-t-${event.seq}`,
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: callId,
            content: [{ type: 'text', text }],
            is_error: message.isError === true,
          },
        ],
      },
    },
  }
}

/** dsh 轮次结束 → RCS 的 `result`，未读与失败标记都靠它。 */
function resultEvent(event: DshSessionEvent): RcsEvent {
  const reason = recordOf(event.data.reason)
  const kind = asText(reason?.kind) || 'error'
  const payload: Record<string, unknown> = {
    type: 'result',
    subtype: kind === 'completed' ? 'success' : kind,
    uuid: `dsh-r-${event.seq}`,
  }
  if (kind !== 'completed') {
    payload.is_error = true
    payload.result = resultMessage(kind, reason)
  }
  return { type: 'result', payload }
}

function resultMessage(kind: string, reason: Record<string, unknown> | null): string {
  if (kind === 'error') {
    const failure = recordOf(reason?.error)
    return asText(failure?.message) || 'dsh turn failed'
  }
  if (kind === 'aborted') return 'Interrupted'
  return kind
}

/**
 * 翻译一个 dsh 会话事件。`user/message`（包括 dsh 注入的合成上下文）不回发：
 * RCS 侧已经有用户发出的原始消息，回发会重复。
 */
export function translateSessionEvent(event: DshSessionEvent): RcsEvent[] {
  switch (event.type) {
    case 'assistant/message': {
      const translated = assistantEvent(event)
      return translated ? [translated] : []
    }
    case 'tool/call': {
      const translated = toolCallEvent(event)
      return translated ? [translated] : []
    }
    case 'tool/result': {
      const translated = toolResultEvent(event)
      return translated ? [translated] : []
    }
    case 'turn/end':
      return [resultEvent(event)]
    default:
      return []
  }
}

/** RCS 侧对一次控制请求的答复。 */
export interface ControlResolution {
  approved: boolean
  updatedInput: Record<string, unknown>
  updatedPermissions: Record<string, unknown>[]
  /** 拒绝时用户填写的反馈（dsh 的审批没有反馈通道，plan 问题可作为 custom 透传）。 */
  message: string
}

/**
 * 解析 RCS 经 SSE 下发的控制答复。正常形状是
 * `{response:{subtype:'success', request_id, response:{behavior, updatedInput, updatedPermissions}}}`；
 * 同时容忍未包装的 `{approved, updated_input, updated_permissions}`。
 */
export function parseControlResponse(payload: Record<string, unknown>): ControlResolution | null {
  const response = recordOf(payload.response)
  const inner = recordOf(response?.response)
  if (inner) {
    return {
      approved: asText(inner.behavior) === 'allow',
      updatedInput: recordOf(inner.updatedInput) ?? {},
      updatedPermissions: asArray(inner.updatedPermissions).filter(isRecord),
      message: asText(inner.message),
    }
  }
  if (typeof payload.approved === 'boolean') {
    return {
      approved: payload.approved,
      updatedInput: recordOf(payload.updated_input) ?? {},
      updatedPermissions: asArray(payload.updated_permissions).filter(isRecord),
      message: asText(payload.message),
    }
  }
  return null
}

/** 从 RCS 的 updatedPermissions 里提取「总是允许」的规则，记录到适配器内存。 */
export function allowRulesOf(resolution: ControlResolution): { toolName: string; ruleContent?: string }[] {
  const rules: { toolName: string; ruleContent?: string }[] = []
  for (const suggestion of resolution.updatedPermissions) {
    if (suggestion.type !== 'addRules') continue
    if (asText(suggestion.behavior) !== 'allow') continue
    for (const item of asArray(suggestion.rules)) {
      const rule = recordOf(item)
      const toolName = asText(rule?.toolName)
      if (!toolName) continue
      const ruleContent = asText(rule?.ruleContent)
      rules.push(ruleContent ? { toolName, ruleContent } : { toolName })
    }
  }
  return rules
}

/** dsh 审批只接受一次性判决；「总是允许」由调用方自己短路。 */
export function approvalOutcome(resolution: ControlResolution): 'allowed-once' | 'rejected' {
  return resolution.approved ? 'allowed-once' : 'rejected'
}

/** SDK 反向请求的答复形状；进程内插件直接用 `approvalOutcome`。 */
export function approvalResult(resolution: ControlResolution): Record<string, unknown> {
  return { outcome: approvalOutcome(resolution) }
}

/** dsh `approval/request` → RCS 权限卡。 */
export function approvalRequestEvent(requestId: string, params: Record<string, unknown>): RcsEvent {
  const toolName = asText(params.toolName) || 'unknown'
  const callId = asText(params.callId)
  const reason = asText(params.reason)
  return {
    type: 'control_request',
    payload: {
      type: 'control_request',
      request_id: requestId,
      request: {
        subtype: 'can_use_tool',
        tool_name: toolName,
        ...(callId ? { tool_use_id: callId } : {}),
        ...(reason ? { description: reason } : {}),
        input: {},
        // RCS 把这条建议渲染成「允许会话」按钮；回执带回 updatedPermissions 即落规则。
        permission_suggestions: [
          { type: 'addRules', behavior: 'allow', destination: 'session', rules: [{ toolName }] },
        ],
      },
    },
  }
}

function planReviewIntent(question: Record<string, unknown>): Record<string, unknown> | null {
  const intent = recordOf(question.intent)
  return intent && intent.kind === 'plan-review' ? intent : null
}

/** dsh `user-question/ask` → RCS 的 ExitPlanMode 或 AskUserQuestion 卡片。 */
export function questionRequestEvent(requestId: string, params: Record<string, unknown>): RcsEvent {
  const questions = asArray(params.questions).filter(isRecord)
  const first = questions[0] ?? {}
  const intent = planReviewIntent(first)
  const toolUseId = asText(intent?.callId) || asText(first.callId)

  if (intent) {
    const plan = asText(intent.detail) || asText(first.detail) || asText(first.question)
    return {
      type: 'control_request',
      payload: {
        type: 'control_request',
        request_id: requestId,
        request: {
          subtype: 'can_use_tool',
          tool_name: 'ExitPlanMode',
          ...(toolUseId ? { tool_use_id: toolUseId } : {}),
          ...(asText(first.question) ? { description: asText(first.question) } : {}),
          input: { plan },
        },
      },
    }
  }

  return {
    type: 'control_request',
    payload: {
      type: 'control_request',
      request_id: requestId,
      request: {
        subtype: 'can_use_tool',
        tool_name: 'AskUserQuestion',
        ...(toolUseId ? { tool_use_id: toolUseId } : {}),
        ...(asText(first.question) ? { description: asText(first.question) } : {}),
        input: {
          questions: questions.map((question) => ({
            question: asText(question.question),
            ...(asText(question.header) ? { header: asText(question.header) } : {}),
            ...(asText(question.detail) ? { detail: asText(question.detail) } : {}),
            options: asArray(question.options)
              .filter(isRecord)
              .map((option) => ({
                label: asText(option.label),
                ...(asText(option.description) ? { description: asText(option.description) } : {}),
              }))
              .filter((option) => option.label),
            multiSelect: question.multiSelect === true,
          })),
        },
      },
    },
  }
}

/**
 * dsh question 的答复。普通提问被拒绝时按 `cancelled` 关闭；plan-review 的拒绝
 * 要落成一个明确的选项，模型才能继续修订，反馈作为 custom 透传。
 */
export function questionResult(
  params: Record<string, unknown>,
  resolution: ControlResolution,
): Record<string, unknown> {
  const questions = asArray(params.questions).filter(isRecord)
  const planQuestion = questions.find((question) => planReviewIntent(question) !== null)
  if (!resolution.approved && !planQuestion) return { cancelled: true }
  const answers = recordOf(resolution.updatedInput.answers) ?? {}

  return {
    answers: questions.map((question) => {
      const id = asText(question.id)
      const intent = planReviewIntent(question)
      if (intent) {
        return {
          id,
          selected: planAnswerLabels(question, intent, resolution.approved),
          ...(!resolution.approved && resolution.message ? { custom: resolution.message } : {}),
        }
      }
      return answerForQuestion(id, question, asText(answers[asText(question.question)]))
    }),
  }
}

/** plan-review 的批准标签由 `intent.approve` 指名；其余选项都表示拒绝。 */
function planAnswerLabels(
  question: Record<string, unknown>,
  intent: Record<string, unknown>,
  approved: boolean,
): string[] {
  const approve = asText(intent.approve)
  const labels = asArray(question.options)
    .filter(isRecord)
    .map((option) => asText(option.label))
    .filter(Boolean)
  if (approved) return approve && labels.includes(approve) ? [approve] : []
  const decline = labels.find((label) => label !== approve)
  return decline ? [decline] : []
}

/** RCS 把多选答案用 `", "` 拼接；匹配不上的片段视为自由文本。 */
function answerForQuestion(id: string, question: Record<string, unknown>, value: string): Record<string, unknown> {
  const labels = new Set(
    asArray(question.options)
      .filter(isRecord)
      .map((option) => asText(option.label))
      .filter(Boolean),
  )
  const parts = value
    .split(', ')
    .map((part) => part.trim())
    .filter(Boolean)
  const selected = parts.filter((part) => labels.has(part))
  const custom = parts.filter((part) => !labels.has(part)).join(', ')
  return { id, selected, ...(custom ? { custom } : {}) }
}
