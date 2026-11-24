import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { asText, isRecord } from '@sobird/dsh-bridge/core'

/** 插件本地状态目录：跟随 dsh 的 `DSH_HOME`，默认 `~/.dsh/rcs-bridge`。 */
export function bridgeStateDir(env: Record<string, string | undefined> = process.env): string {
  const home = env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'rcs-bridge')
}

/** 读取上次注册的环境 id；文件缺失或损坏都当作「没有」，不阻断启动。 */
export async function readEnvironmentId(dir: string): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(dir, 'environment.json'), 'utf8'))
    return isRecord(parsed) ? asText(parsed.environmentId) || undefined : undefined
  } catch {
    return undefined
  }
}

/** 原子写入环境 id：临时文件 + rename，权限 0600。 */
export async function writeEnvironmentId(dir: string, environmentId: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const target = join(dir, 'environment.json')
  const temp = `${target}.tmp`
  await writeFile(temp, JSON.stringify({ version: 1, environmentId }), { mode: 0o600 })
  await rename(temp, target)
}
