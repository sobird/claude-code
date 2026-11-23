/**
 * CLI 排队消息的桥接视图。
 *
 * 队列的唯一真值在 CLI 内存里；网关只是把 `queue_snapshot` 控制消息原样转发，
 * 因此这里的解析必须是防御性的——远程端永远不能因为一条坏快照而崩掉。
 */

export type QueuePriority = 'now' | 'next' | 'later'

/** 一条等待 CLI 消费的消息。带附件的条目 `editable` 为 false（只能删除/插话）。 */
export interface QueuedMessage {
  uuid: string
  content: string
  priority: QueuePriority
  editable: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function priorityOf(value: unknown): QueuePriority {
  return value === 'now' || value === 'later' ? value : 'next'
}

/**
 * 从 `queue_snapshot` 载荷（归一化载荷或控制响应均可）中取出队列。
 * 缺失/非数组视为空队列；格式不对的条目直接丢弃。
 */
export function parseQueue(payload: unknown): QueuedMessage[] {
  const record = asRecord(payload)
  const raw = Array.isArray(payload) ? payload : record && Array.isArray(record.queue) ? record.queue : []
  const queue: QueuedMessage[] = []
  for (const item of raw) {
    const entry = asRecord(item)
    if (!entry) continue
    const uuid = typeof entry.uuid === 'string' ? entry.uuid : ''
    if (!uuid) continue
    queue.push({
      uuid,
      content: typeof entry.content === 'string' ? entry.content : '',
      priority: priorityOf(entry.priority),
      editable: entry.editable === true,
    })
  }
  return queue
}
