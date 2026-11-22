import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import { RootShell } from '@/components/shell/RootShell'
import { baseMetadata, baseViewport } from '@/lib/metadata'

// oxlint-disable-next-line import/no-unassigned-import -- global stylesheet side effect
import '@/app/globals.css'

export const metadata: Metadata = { ...baseMetadata, title: 'Sobird' }

export const viewport: Viewport = baseViewport

/**
 * The offline fallback is served by the service worker with no request context
 * (no cookies, no locale negotiation) and is prerendered statically. Its copy is
 * bilingual in the page itself, so `lang` stays a fixed `en` rather than
 * resolving a per-request locale here.
 */
export default function OfflineLayout({ children }: { children: ReactNode }) {
  return <RootShell lang="en">{children}</RootShell>
}
