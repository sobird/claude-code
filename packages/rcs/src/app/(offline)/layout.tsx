import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import { RootShell } from '../../components/shell/root-shell'
import { baseMetadata, baseViewport } from '../../lib/metadata'

// oxlint-disable-next-line import/no-unassigned-import -- global stylesheet side effect
import '../globals.css'

export const metadata: Metadata = { ...baseMetadata, title: 'Remote Control' }

export const viewport: Viewport = baseViewport

export default function OfflineLayout({ children }: { children: ReactNode }) {
  return <RootShell lang="en">{children}</RootShell>
}
