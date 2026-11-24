/**
 * 尽力而为地打开浏览器：只接受 http(s)，失败静默（配对 URL 已打印到 stderr）。
 *
 * 注入 `spawnDetached` 便于测试；默认实现用分离的子进程，不阻塞宿主退出。
 */

import { spawn } from 'node:child_process'

export interface SpawnedBrowser {
  on(event: 'error', listener: () => void): void
  unref(): void
}

export type SpawnDetached = (command: string, args: string[]) => SpawnedBrowser

const defaultSpawn: SpawnDetached = (command, args) => spawn(command, args, { stdio: 'ignore', detached: true })

function commandFor(url: string): { command: string; args: string[] } {
  if (process.platform === 'darwin') return { command: 'open', args: [url] }
  if (process.platform === 'win32') return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] }
  return { command: 'xdg-open', args: [url] }
}

/** 打开配对页；非 http(s) 或无效 URL 直接忽略。 */
export function openBrowser(url: string, spawnDetached: SpawnDetached = defaultSpawn): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return

  try {
    const { command, args } = commandFor(url)
    const child = spawnDetached(command, args)
    child.on('error', () => {})
    child.unref()
  } catch {
    // 打不开浏览器不影响配对。
  }
}
