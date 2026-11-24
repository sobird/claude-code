/** `worker_type` → 环境列表徽标的 `dashboard.environments.*` 文案键。 */

export type EnvironmentTypeLabel = 'acpAgent' | 'claudeCode' | 'deepseek'

const LABELS: Record<string, EnvironmentTypeLabel> = {
  claude_code: 'claudeCode',
  acp: 'acpAgent',
  deepseek: 'deepseek',
}

/** 未知类型返回 undefined，由调用方原样展示 `worker_type`。 */
export function environmentTypeLabel(workerType: string): EnvironmentTypeLabel | undefined {
  return LABELS[workerType]
}
