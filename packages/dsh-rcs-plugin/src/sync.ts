import { asText, errorMessage, type RcsClient, type WorkerSession } from '@sobird/dsh-bridge/core'

import type { ResolvedConfig } from './config'
import { bridgeStateDir } from './environment-state'
import { readSidecar, recordSync, rcsIdForAgent } from './sidecar'
import type { SessionSupervisor } from './supervisor'
import { isSessionQuery, type CommandResultLike, type PluginContextLike } from './types'

/** 插件自己创建的 RCS 会话前缀；已带这个前缀的会话不需要同步。 */
const RCS_SESSION_PREFIX = 'cse_'

export interface SyncDeps {
  ctx: PluginContextLike
  supervisor: SessionSupervisor
  config: ResolvedConfig
  rcs: RcsClient
}

/** 取 dsh 会话标题；`sessionQuery` 不可用或没有标题时退化成会话 id。 */
async function titleFor(ctx: PluginContextLike, agentSessionId: string): Promise<string> {
  const query = ctx.get('sessionQuery')
  if (!isSessionQuery(query)) return agentSessionId
  try {
    const records = await query.listSessions()
    const record = records.find((entry) => asText(entry.header?.id) === agentSessionId)
    return asText(record?.header?.title) || agentSessionId
  } catch {
    return agentSessionId
  }
}

/**
 * 把一条既有 dsh 会话手动同步到 RCS：新建 RCS 会话、带环境派发，再按双 id 桥接。
 * 只同步后续轮次，历史不回填；映射在建会话后立即落盘，这样即使换票/起桥失败，
 * 后续环境派发也能凭它找回 dsh 会话 id。
 */
export async function syncSession(deps: SyncDeps, agentSessionId: string): Promise<CommandResultLike> {
  if (!agentSessionId) return { kind: 'error', text: '当前没有可同步的 dsh 会话' }
  if (agentSessionId.startsWith(RCS_SESSION_PREFIX)) {
    return { kind: 'success', text: `会话 ${agentSessionId} 已由 RCS 管理，无需同步` }
  }

  const stateDir = bridgeStateDir()
  const existing = rcsIdForAgent(await readSidecar(stateDir), agentSessionId)
  if (existing) return { kind: 'success', text: `会话已同步为 RCS 会话 ${existing}（重复执行不会新建）` }

  const title = await titleFor(deps.ctx, agentSessionId)
  let rcsSessionId: string
  let worker: WorkerSession
  try {
    rcsSessionId = await deps.rcs.createSession(title, deps.supervisor.environmentId)
    await recordSync(stateDir, agentSessionId, rcsSessionId)
    worker = await deps.rcs.openWorker(rcsSessionId)
    await deps.supervisor.attach(rcsSessionId, agentSessionId, worker)
  } catch (error) {
    return { kind: 'error', text: `同步失败：${errorMessage(error)}` }
  }

  try {
    await deps.rcs.setExternalMetadata(worker, { dsh_session_id: agentSessionId })
  } catch (error) {
    process.stderr.write(`[dsh-rcs-plugin] external metadata: ${errorMessage(error)}\n`)
  }
  return {
    kind: 'success',
    text: `已同步到 RCS 会话 ${rcsSessionId}；历史消息不会回填，之后的轮次会双向同步`,
  }
}
