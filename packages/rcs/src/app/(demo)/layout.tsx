import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import { RootShell } from '@/components/shell/RootShell'
import { baseMetadata, baseViewport } from '@/lib/metadata'

// oxlint-disable-next-line import/no-unassigned-import -- global stylesheet side effect
import '@/app/globals.css'

export const metadata: Metadata = {
  ...baseMetadata,
  title: 'Sobird — 控制台设计研究',
  description: 'Sobird 远程控制台的交互设计演示。',
}

export const viewport: Viewport = baseViewport

/**
 * Standalone root layout for the interaction-design demo. It deliberately skips
 * the authenticated app shell so the proposed console can own the full
 * viewport; `proxy.ts` still gates `/demo` like every other page.
 */
export default function DemoLayout({ children }: { children: ReactNode }) {
  return <RootShell lang="en">{children}</RootShell>
}
