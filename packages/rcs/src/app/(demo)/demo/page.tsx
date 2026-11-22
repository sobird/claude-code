import { DemoConsole } from '@/components/demo/DemoConsole'

/**
 * `/demo` — a self-contained design study for the console UI.
 *
 * All data is local mock data; nothing here talks to the gateway. The page
 * exists to review the interaction model before porting it onto the real
 * dashboard and session surfaces.
 */
export default function DemoPage() {
  return <DemoConsole />
}
