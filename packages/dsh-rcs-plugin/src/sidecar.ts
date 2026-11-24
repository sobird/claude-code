import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { asText, isRecord } from '@sobird/dsh-bridge/core'

/** 一条手动同步记录：dsh 会话 id → RCS 会话 id。 */
export interface SidecarEntry {
  rcsSessionId: string
  syncedAt: string
}

export type SidecarMap = Record<string, SidecarEntry>

function sidecarPath(dir: string): string {
  return join(dir, 'sessions.json')
}

/**
 * 解析失败时把原文件改名为 `.bak` 并按空表处理：损坏的映射不能阻断启动。
 * 只有文件不存在才算空表；权限等其他读取错误上抛，避免把可修复的配置问题吞成「无记录」。
 */
export async function readSidecar(dir: string): Promise<SidecarMap> {
  const path = sidecarPath(dir)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    const code = isRecord(error) ? asText(error.code) : ''
    if (code === 'ENOENT' || code === 'ENOTDIR') return {}
    throw error
  }
  try {
    const parsed: unknown = JSON.parse(text)
    const sessions = isRecord(parsed) && isRecord(parsed.sessions) ? parsed.sessions : null
    const map: SidecarMap = {}
    if (sessions) {
      for (const [dshSessionId, value] of Object.entries(sessions)) {
        if (!isRecord(value)) continue
        const rcsSessionId = asText(value.rcsSessionId)
        if (!rcsSessionId) continue
        map[dshSessionId] = { rcsSessionId, syncedAt: asText(value.syncedAt) }
      }
    }
    return map
  } catch {
    await rename(path, `${path}.bak`).catch(() => undefined)
    return {}
  }
}

/** 原子写入（临时文件 + rename），权限 0600。 */
export async function writeSidecar(dir: string, map: SidecarMap): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const target = sidecarPath(dir)
  const temp = `${target}.tmp`
  await writeFile(temp, JSON.stringify({ version: 1, sessions: map }), { mode: 0o600 })
  await rename(temp, target)
}

/** 记录一条同步；同一条 dsh 会话重复同步会覆盖旧记录。 */
export async function recordSync(dir: string, dshSessionId: string, rcsSessionId: string): Promise<void> {
  const map = await readSidecar(dir)
  map[dshSessionId] = { rcsSessionId, syncedAt: new Date().toISOString() }
  await writeSidecar(dir, map)
}

/** 环境派发来的 RCS 会话如果来自手动同步，用反向查表找回 dsh 会话 id。 */
export function agentIdForRcs(map: SidecarMap, rcsSessionId: string): string | undefined {
  for (const [dshSessionId, entry] of Object.entries(map)) {
    if (entry.rcsSessionId === rcsSessionId) return dshSessionId
  }
  return undefined
}

export function rcsIdForAgent(map: SidecarMap, dshSessionId: string): string | undefined {
  return map[dshSessionId]?.rcsSessionId
}
