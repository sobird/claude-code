import { SessionView } from '../../../components/chat/chat-view'

/**
 * `/code/:sessionId` — session detail.
 *
 * The data is client-rendered with the access-token client (history + SSE);
 * the layout already guards authentication, so this server component only
 * unwraps the route params (a Promise in Next 16).
 */
export default async function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  return <SessionView sessionId={sessionId} />
}
