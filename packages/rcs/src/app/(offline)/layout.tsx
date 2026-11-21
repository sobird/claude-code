import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import { RootShell } from '@/components/shell/RootShell'
import { baseMetadata, baseViewport } from '@/lib/metadata'

// oxlint-disable-next-line import/no-unassigned-import -- global stylesheet side effect
import '@/app/globals.css'

export const metadata: Metadata = { ...baseMetadata, title: 'Sobird' }

export const viewport: Viewport = baseViewport

export default function OfflineLayout({ children }: { children: ReactNode }) {
  return <RootShell lang="en">{children}</RootShell>
}
