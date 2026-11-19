/**
 * Assistant (KAIROS) mode entry points.
 *
 * Assistant mode turns the CLI into a persistent, proactive agent: it reads a
 * custom prompt addendum, kicks off with the brief view, and pre-seeds an
 * in-process teammate team so `Agent(name: "…")` spawns teammates without a
 * TeamCreate round-trip.
 *
 * Activation is (settings.assistant === true) OR an explicit `--assistant`
 * latch, and the caller separately checks the `tengu_kairos` gate. The daemon
 * that launches children with `--assistant` has already verified entitlement,
 * so it sets the latch to skip the child's gate check.
 */

import { join } from 'node:path'

import { getOriginalCwd, getSessionId } from '../bootstrap/state.js'
import type { AppState } from '../state/AppStateStore.js'
import { formatAgentId } from '../utils/agentId.js'
import { getCwd } from '../utils/cwd.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { getFsImplementation } from '../utils/fsOperations.js'
import { getInitialSettings } from '../utils/settings/settings.js'
import { setCliTeammateModeOverride } from '../utils/swarm/backends/teammateModeSnapshot.js'
import { TEAM_LEAD_NAME } from '../utils/swarm/constants.js'
import {
  getTeamFilePath,
  readTeamFileAsync,
  registerTeamForSessionCleanup,
  sanitizeName,
  writeTeamFileAsync,
  type TeamFile,
} from '../utils/swarm/teamHelpers.js'
import { ensureTasksDir, resetTaskList, setLeaderTeamName } from '../utils/tasks.js'

/** Set by `--assistant`; lets the daemon-launched child skip the gate check. */
let forced = false

/** Marks assistant mode as explicitly requested, bypassing the entitlement gate. */
export function markAssistantForced(): void {
  forced = true
}

/** Whether assistant mode was forced via `--assistant` rather than settings. */
export function isAssistantForced(): boolean {
  return forced
}

/**
 * Whether this session is in assistant mode. Reflects the forced latch and
 * `.claude/settings.json`'s `assistant` flag; the `tengu_kairos` entitlement
 * check lives in the caller so this stays synchronous (it runs before the
 * trust dialog).
 */
export function isAssistantMode(): boolean {
  if (forced) return true
  return getInitialSettings()?.assistant === true
}

function getAssistantAgentsDir(): string {
  return join(getOriginalCwd(), '.claude', 'agents')
}

function getAssistantPromptPath(): string {
  return join(getAssistantAgentsDir(), 'assistant.md')
}

/**
 * How assistant mode was activated, for telemetry: `'daemon'` when a daemon
 * launched this process with `--assistant` (entitlement already checked by the
 * parent), `'gate'` when settings plus the `tengu_kairos` gate enabled it.
 * The value is sent as `assistantActivationPath`, which is typed as
 * "not code or file paths", so it must be a bare token — never a file path.
 */
export function getAssistantActivationPath(): string | undefined {
  return isAssistantForced() ? 'daemon' : 'gate'
}

/**
 * Reads `.claude/agents/assistant.md` as the extra system-prompt text for
 * assistant mode. Missing or unreadable files yield an empty addendum rather
 * than failing startup.
 */
export function getAssistantSystemPromptAddendum(): string {
  const path = getAssistantPromptPath()
  try {
    const fs = getFsImplementation()
    if (!fs.existsSync(path)) return ''
    return fs.readFileSync(path, { encoding: 'utf8' })
  } catch (error) {
    logForDebugging(`[assistant] failed to read prompt addendum: ${errorMessage(error)}`)
    return ''
  }
}

/**
 * Pre-seeds the assistant leader's team so teammates spawn in-process.
 *
 * The teammate-mode override must be set here (before setup() captures the
 * snapshot). Returns the teamContext to seed `AppState`, or undefined if team
 * setup fails — assistant mode still works without pre-seeded teammates, so a
 * failure must never abort startup.
 */
export async function initializeAssistantTeam(): Promise<AppState['teamContext'] | undefined> {
  setCliTeammateModeOverride('in-process')

  try {
    // Scope the team to this session: teams are per-leader and session-end
    // cleanup (cleanupSessionTeams) deletes the team + task dirs, so sharing a
    // fixed name across concurrent sessions would let one exit clobber another.
    // A resumed session keeps the same id and therefore the same team.
    const sessionId = getSessionId()
    const baseName = sanitizeName(getInitialSettings()?.assistantName || 'assistant')
    const teamName = sanitizeName(`${baseName}-${sessionId.slice(0, 8)}`)
    const leadAgentId = formatAgentId(TEAM_LEAD_NAME, teamName)
    const cwd = getCwd()

    // Reuse this session's existing team file (e.g. after --resume).
    const existing = await readTeamFileAsync(teamName)
    let teamFile: TeamFile
    if (existing) {
      teamFile = existing
    } else {
      teamFile = {
        name: teamName,
        createdAt: Date.now(),
        leadAgentId,
        leadSessionId: sessionId,
        members: [
          {
            agentId: leadAgentId,
            name: TEAM_LEAD_NAME,
            agentType: TEAM_LEAD_NAME,
            joinedAt: Date.now(),
            tmuxPaneId: '',
            cwd,
            subscriptions: [],
          },
        ],
      }
      await writeTeamFileAsync(teamName, teamFile)
      registerTeamForSessionCleanup(teamName)
      // Fresh team → fresh task list (Team = Project = TaskList), matching
      // TeamCreateTool. Never reset on reuse, or a resumed session loses tasks.
      await resetTaskList(teamName)
      await ensureTasksDir(teamName)
    }
    // Route this leader's task operations at the team's task list.
    setLeaderTeamName(teamName)

    return {
      teamName,
      teamFilePath: getTeamFilePath(teamName),
      leadAgentId,
      teammates: {
        [leadAgentId]: {
          name: TEAM_LEAD_NAME,
          agentType: TEAM_LEAD_NAME,
          tmuxSessionName: '',
          tmuxPaneId: '',
          cwd,
          spawnedAt: teamFile.createdAt,
        },
      },
    }
  } catch (error) {
    logForDebugging(`[assistant] failed to initialize team: ${errorMessage(error)}`)
    return undefined
  }
}
