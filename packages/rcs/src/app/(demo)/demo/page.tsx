import { DemoConsole } from '@/components/demo/DemoConsole'

/**
 * `/demo` —— 控制台界面的交互设计研究。
 *
 * 默认渲染实时的网关数据（会话、环境、对话流），在查看者接管前保持只读；
 * 发送和审批由该开关控制。`?source=mock` 保留原有的自包含 mock 研究，
 * 用于在无需账号的情况下审视视觉效果。
 */
export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const source = params.source === 'mock' ? 'mock' : 'live'
  return <DemoConsole source={source} />
}
