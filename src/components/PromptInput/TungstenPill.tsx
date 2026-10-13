import figures from 'figures'

import { Text, Link } from '../../ink.js'

type Props = {
  key?: string
  selected?: boolean
}

/**
 * TungstenPill displays a tmux session indicator for ANT (internal) builds.
 *
 * Shows an interactive pill that indicates an active tmux session managed by
 * the Tungsten tool. When clicked, it opens the tmux session URL/connection.
 */
export function TungstenPill({ selected = false }: Props): React.ReactNode {
  // In ANT builds with active tmux sessions, show the tmux indicator
  // The session info would typically come from AppState.tungstenActiveSession
  const tmuxUrl = '#' // Placeholder - actual URL would come from state
  const sessionName = 'tmux' // Default session name

  return (
    <Link url={tmuxUrl}>
      <Text color={selected ? 'ansi:blue' : 'ansi:black'}>
        {figures.squareSmallFilled} {sessionName}
      </Text>
    </Link>
  )
}
