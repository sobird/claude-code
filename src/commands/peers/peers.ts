/**
 * /peers — list the other Claude Code sessions running on this machine.
 *
 * Reads the same PID registry as `claude ps` and the ListPeers tool
 * (`~/.claude/sessions/<pid>.json`). This session and dead PIDs are already
 * filtered out by listAllLiveSessions().
 */

import type { LocalCommandCall } from '../../types/command.js'
import { listAllLiveSessions, type LiveSession } from '../../utils/udsClient.js'

/** Renders the peer table. Name falls back to the session ID, then the PID. */
export function formatPeers(peers: LiveSession[]): string {
  if (peers.length === 0) return 'No other Claude Code sessions are running.'

  const header = ['NAME', 'ID', 'KIND', 'PID', 'CWD']
  const rows = peers.map((peer) => [
    peer.name ?? (peer.sessionId ? `session ${peer.sessionId.slice(0, 8)}` : `pid ${peer.pid}`),
    peer.sessionId ? peer.sessionId.slice(0, 8) : '-',
    peer.kind || '-',
    String(peer.pid),
    peer.cwd || '-',
  ])

  const widths = header.map((cell, column) => Math.max(cell.length, ...rows.map((row) => row[column].length)))
  const render = (row: string[]): string =>
    row
      .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column])))
      .join('  ')
      .trimEnd()

  return [render(header), ...rows.map(render)].join('\n')
}

export const call: LocalCommandCall = async () => {
  const peers = (await listAllLiveSessions()).toSorted((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
  return { type: 'text', value: formatPeers(peers) }
}
