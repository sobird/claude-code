import { randomUUID } from 'node:crypto'

/** dsh 期望的用户消息最小形状：冻结、带稳定 id，source 标记为用户输入。 */
export interface UserMessageLike {
  readonly id: string
  readonly role: 'user'
  readonly content: readonly unknown[]
  readonly source: { kind: 'user' }
}

/** 递归冻结；dsh 的 `createUserMessage` 会在发布前冻结消息，这里复刻同一约束。 */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

/** 等价于 `@deepseek-ai/dsh-llm` 的 `createUserMessage`，避免引入运行时依赖。 */
export function createUserMessage(content: readonly unknown[]): UserMessageLike {
  return deepFreeze(
    structuredClone({
      id: randomUUID(),
      role: 'user' as const,
      content,
      source: { kind: 'user' as const },
    }),
  )
}
