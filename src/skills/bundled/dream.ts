import { getOriginalCwd } from '../../bootstrap/state.js'
import { getAutoMemPath, isAutoMemoryEnabled } from '../../memdir/paths.js'
import { buildConsolidationPrompt } from '../../services/autoDream/consolidationPrompt.js'
import { getProjectDir } from '../../utils/sessionStorage.js'
import { registerBundledSkill } from '../bundledSkills.js'

/**
 * /dream — manual memory consolidation. Runs the same orient/gather/
 * consolidate/prune prompt as the nightly auto-dream pass, but in the main
 * loop with normal permissions.
 */
export function registerDreamSkill(): void {
  registerBundledSkill({
    name: 'dream',
    description:
      'Consolidate recent memories: merge new signal into existing topic files, fix drifted facts, prune stale entries, and refresh the index.',
    whenToUse:
      'Use when the user wants to consolidate memory now instead of waiting for the nightly auto-dream pass. Same four phases as auto-dream, run in the main loop.',
    userInvocable: true,
    isEnabled: isAutoMemoryEnabled,
    async getPromptForCommand(args) {
      const prompt = buildConsolidationPrompt(getAutoMemPath(), getProjectDir(getOriginalCwd()), args.trim())
      return [{ type: 'text', text: prompt }]
    },
  })
}
