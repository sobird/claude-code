/**
 * CLI 侧的排队消息控制：把 RCS 的 queue_update 请求落到本地队列。
 *
 * 队列唯一真值在 `messageQueueManager`（CLI 内存）；这里只做协议到原语的映射，
 * 不复制状态。edit/steer 都原地改，保持 uuid 与相对顺序。
 */
import {
  getBridgeQueueSnapshot,
  removeByFilter,
  subscribeToCommandQueue,
  updateQueuedCommand,
} from '../utils/messageQueueManager.js'
import type { BridgeQueueItem, BridgeQueueUpdate, BridgeQueueUpdateResult } from './bridgeMessaging.js'

/** 队列快照的推送节流：一轮里 dequeue/enqueue 会连续触发，合并成一帧。 */
const SNAPSHOT_DEBOUNCE_MS = 150

/**
 * 应用一次远程队列操作。
 *
 * `canSteer` 由调用方按"当前是否有一轮在跑"给出——没有进行中的轮次时，
 * `later` 本来就马上会被取走，插话没有意义，回 `steer-unavailable` 让前端关掉按钮。
 */
export function applyQueueUpdate(update: BridgeQueueUpdate, options: { canSteer: boolean }): BridgeQueueUpdateResult {
  const { action, uuid } = update

  if (action === 'steer') {
    if (!options.canSteer) return { ok: false, error: 'steer-unavailable' }
    return updateQueuedCommand(uuid, { priority: 'next' })
      ? { ok: true, queue: getBridgeQueueSnapshot() }
      : { ok: false, error: 'queue-item-not-found' }
  }

  if (action === 'edit') {
    if ((update.content ?? '').trim() === '') return { ok: false, error: 'invalid-content' }
    return updateQueuedCommand(uuid, { value: update.content ?? '' })
      ? { ok: true, queue: getBridgeQueueSnapshot() }
      : { ok: false, error: 'queue-item-not-found' }
  }

  // 被消费掉的条目会先出队，重复删除收敛为 not-found 而不是报错。
  const removed = removeByFilter((cmd) => cmd.uuid === uuid)
  return removed.length > 0
    ? { ok: true, queue: getBridgeQueueSnapshot() }
    : { ok: false, error: 'queue-item-not-found' }
}

/** 订阅队列变化并节流推送快照；返回取消订阅函数。 */
export function subscribeBridgeQueueChanges(send: (queue: BridgeQueueItem[]) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const unsubscribe = subscribeToCommandQueue(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      send(getBridgeQueueSnapshot())
    }, SNAPSHOT_DEBOUNCE_MS)
  })
  return () => {
    if (timer) clearTimeout(timer)
    unsubscribe()
  }
}

export { getBridgeQueueSnapshot }
