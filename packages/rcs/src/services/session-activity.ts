/**
 * 会话活动聚合：归档守卫用它回答"这个会话还有什么在跑"。
 *
 * 只取网关可观测量——在途 work item、CLI bridge 连接、挂起的 control 请求。
 * 刻意不读 `sessions.status === 'running'`：进程崩溃后该值会陈旧，误判交给
 * disconnect monitor 的超时扫描，而不是挡在归档入口。
 */

import type { Repositories } from '@/db/repositories/types'
import { hasPendingControlRequests } from '@/transport/bridge-requests'
import { getEventBus, publishSessionEvent } from '@/transport/event-bus'
import { closeBridgeConnection, hasBridgeConnection } from '@/transport/ws-handler'

import { stopWork } from './work-dispatch.js'

export interface SessionActivity {
  kind: 'work_item' | 'bridge' | 'control'
  /** 稳定的观测 id（work item id 等），便于调用方定位。 */
  id?: string
  /** 面向用户的短标签，与 API 错误信息保持英文一致。 */
  label: string
}

/** 汇总会话当前可见的活动，按 work item → bridge → control 的固定顺序排列。 */
export async function listSessionActivity(repos: Repositories, sessionId: string): Promise<SessionActivity[]> {
  const activity: SessionActivity[] = []

  const item = await repos.workItems.getInflightBySession(sessionId)
  if (item) {
    activity.push({
      kind: 'work_item',
      id: item.id,
      label: item.state === 'dispatched' ? 'Leased work item' : 'Queued work item',
    })
  }
  if (hasBridgeConnection(sessionId)) activity.push({ kind: 'bridge', label: 'Connected bridge' })
  if (hasPendingControlRequests(sessionId)) activity.push({ kind: 'control', label: 'Pending control request' })

  return activity
}

/**
 * 先写后停：归档已经落库后，主动结束会话上的活动——停掉在途 work item、向存活的
 * bridge 发一次中断、再关掉 socket。顺序上先发 interrupt 再 close，bridge 才收得到
 * 中止信号；socket 关闭时会顺带清掉挂起的 control 等待者。
 */
export async function stopSessionActivity(repos: Repositories, sessionId: string): Promise<void> {
  const item = await repos.workItems.getInflightBySession(sessionId)
  if (item) await stopWork(repos, item.id)
  await publishSessionEvent(repos, getEventBus(sessionId), sessionId, 'interrupt', { action: 'interrupt' }, 'outbound')
  closeBridgeConnection(sessionId, 1001, 'session_archived')
}
