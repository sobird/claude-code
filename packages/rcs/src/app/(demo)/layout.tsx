import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import { RootShell } from '@/components/shell/RootShell'
import { baseMetadata, baseViewport } from '@/lib/metadata'

// oxlint-disable-next-line import/no-unassigned-import -- 引入全局样式表的副作用
import '@/app/globals.css'

export const metadata: Metadata = {
  ...baseMetadata,
  title: 'Sobird — 控制台设计研究',
  description: 'Sobird 远程控制台的交互设计演示。',
}

export const viewport: Viewport = baseViewport

/**
 * 交互设计演示的独立根布局。它刻意跳过需要认证的应用外壳，让拟议中的控制台
 * 独占整个视口；`proxy.ts` 让 `/demo` 保持公开，以便无需账号即可审阅，
 * 页面自身则通过界面内的「接管」开关来限制写入。
 */
export default function DemoLayout({ children }: { children: ReactNode }) {
  return <RootShell lang="en">{children}</RootShell>
}
