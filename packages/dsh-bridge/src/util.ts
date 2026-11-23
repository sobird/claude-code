/** JSON 与运行时边界的共享守卫；这里不做任何业务判断。 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

export function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

/** 解析模型给的 JSON 参数；失败时退化为空对象，避免拖垮整条消息。 */
export function parseJsonObject(value: string): Record<string, unknown> {
  if (!value.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
