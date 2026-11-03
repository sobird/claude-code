import type { Command } from '../../commands.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { isEssentialTrafficOnly } from '../../utils/privacyLevel.js'

// Mirrors upstream H_7: first-party API, not essential-traffic-only, and live
// once the 2026-04 wave starts. Internal (ant) builds skip the date gate.
function isBuddyCommandVisible(): boolean {
  if (getAPIProvider() !== 'firstParty') return false
  if (isEssentialTrafficOnly()) return false
  if (process.env.USER_TYPE === 'ant') return true
  const d = new Date()
  return d.getFullYear() > 2026 || (d.getFullYear() === 2026 && d.getMonth() >= 3)
}

const command = {
  type: 'local-jsx',
  name: 'buddy',
  description: 'Hatch a coding companion · pet, off',
  isHidden: !isBuddyCommandVisible(),
  immediate: true,
  load: () => import('./buddy.js'),
} satisfies Command

export default command
