/**
 * 设备码配对得到的凭据文件：`<stateDir>/credentials.json`，0600 原子写。
 *
 * 明文 key 只在这里落盘一次。读取时缺失/指向不存在的路径都当作「没有」；
 * 损坏的 JSON 改名 `.bak` 后同样返回 null，避免每次启动都卡在同一个坏文件上。
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { asText, isRecord } from '@sobird/dsh-bridge/core'

export interface StoredCredentials {
  version: 1
  rcsBaseUrl: string
  apiKey: string
  createdAt: string
}

const FILENAME = 'credentials.json'

function errorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

function isStoredCredentials(value: unknown): value is StoredCredentials {
  if (!isRecord(value)) return false
  return (
    value.version === 1 &&
    asText(value.rcsBaseUrl).length > 0 &&
    asText(value.apiKey).length > 0 &&
    asText(value.createdAt).length > 0
  )
}

/** 读取凭据；目录或文件缺失、内容损坏都返回 null。 */
export async function readCredentials(dir: string): Promise<StoredCredentials | null> {
  const target = join(dir, FILENAME)

  let raw: string
  try {
    raw = await readFile(target, 'utf8')
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw error
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (isStoredCredentials(parsed)) return parsed
  } catch {
    // 落到下面的隔离逻辑。
  }

  try {
    await rename(target, `${target}.bak`)
  } catch {
    // 并发删除或不可写：本次仍按「没有凭据」返回。
  }
  return null
}

/** 原子写入凭据：临时文件 + rename，目录 0700、文件 0600。 */
export async function writeCredentials(dir: string, credentials: StoredCredentials): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const target = join(dir, FILENAME)
  const temp = `${target}.tmp`
  await writeFile(temp, JSON.stringify(credentials), { mode: 0o600 })
  await rename(temp, target)
}

/** 删除凭据文件；不存在也算成功。 */
export async function clearCredentials(dir: string): Promise<void> {
  try {
    await unlink(join(dir, FILENAME))
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return
    throw error
  }
}
