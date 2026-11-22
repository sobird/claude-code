import { DemoConsole } from '@/components/demo/DemoConsole'

/**
 * `/demo` — an interaction-design study for the console UI.
 *
 * By default it renders live gateway data (sessions, environments, transcript
 * stream) read-only until the viewer takes over; sending and approvals are
 * gated behind that toggle. `?source=mock` keeps the original self-contained
 * mock study for reviewing the visuals without an account.
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
