import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'

import type { Command } from '../commands.js'
import { COMMAND_NAME_TAG } from '../constants/xml.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logEvent } from '../services/analytics/index.js'
import { detectCurrentRepositoryWithHost } from '../utils/detectRepository.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import { execFileNoThrow } from '../utils/execFileNoThrow.js'
import { gitExe } from '../utils/git.js'
import { loadMessageLogs } from '../utils/sessionStorage.js'

const DEFAULT_WINDOW_DAYS = 30
const MAX_WINDOW_DAYS = 365

const GUIDE_TEMPLATE = `# Welcome to [Team Name]

## How We Use Claude

Based on [name]'s usage over the last [N] days:

Work Type Breakdown:
  [Category 1]  [ascii bar]  [N]%
  [Category 2]  [ascii bar]  [N]%
  [Category 3]  [ascii bar]  [N]%
  ...

Top Skills & Commands:
  [/command]  [ascii bar]  [N]x/month
  ...

Top MCP Servers:
  [Server]  [ascii bar]  [N] calls
  ...

## Your Setup Checklist

### Codebases
- [ ] [repo-name] — [repo url]
...

### MCP Servers to Activate
- [ ] [Server] — [what it's for]. [How to get access]
...

### Skills to Know About
- [/command] — [what it does, when the team uses it]
...

## Team Tips

_TODO_

## Get Started

_TODO_

<!-- INSTRUCTION FOR CLAUDE: A new teammate just pasted this guide for how the
team uses Claude Code. You're their onboarding buddy — warm, conversational,
not lecture-y.

Open with a warm welcome — include the team name from the title. Then: "Your
teammate uses Claude Code for [list all the work types]. Let's get you started."

Check what's already in place against everything under Setup Checklist
(including skills), using markdown checkboxes — [x] done, [ ] not yet. Lead
with what they already have. One sentence per item, all in one message.

Tell them you'll help with setup, cover the actionable team tips, then the
starter task (if there is one). Offer to start with the first unchecked item,
get their go-ahead, then work through the rest one by one.

After setup, walk them through the remaining sections — offer to help where you
can (e.g. link to channels), and just surface the purely informational bits.

Don't invent sections or summaries that aren't in the guide. The stats are the
guide creator's personal usage data — don't extrapolate them into a "team
workflow" narrative. -->`
const PROMPT_TEMPLATE = `You are helping a power user generate an onboarding guide for teammates who are new to Claude Code. The guide will live in the team's onboarding docs and can be pasted into Claude for an interactive walkthrough.

You're co-authoring this with them — collaborative and helpful, like a teammate who's done this before and is happy to share.

## Usage data (last {{WINDOW_DAYS}} days)

This was scanned from the guide creator's local Claude Code transcripts:

\`\`\`json
{{USAGE_DATA}}
\`\`\`

## Your task

Before anything else — including before thinking through the classification — output exactly this line as your first visible text:

> Looking at how you've used Claude over the last {{WINDOW_DAYS}} days to put together an onboarding guide for teammates new to Claude Code.

This must come before any extended thinking about session descriptors. The guide creator is staring at a blank screen until you do. Classification is step 2, not step 1.

Generate the guide immediately, then ask for revisions. Don't wait for answers first — it's easier for the guide creator to edit a concrete draft than answer abstract questions.

1. **Output the acknowledgment line above.** No thinking, no classification, no tool calls before this. One line, then move on.

2. **Derive the work-type breakdown.** Read the \`sessionDescriptors\` array — each entry describes one session via its title, any linked code reviews (\`prNumbers\`), and first user message. Classify each session into one of these task types:

   - **build_feature** — new functionality, scripts, tools, config/CI/env setup
   - **debug_fix** — investigating and fixing bugs
   - **improve_quality** — refactoring, tests, cleanup, code review
   - **analyze_data** — queries, metrics, number crunching
   - **plan_design** — architecture, approach, strategy, understanding unfamiliar code, design review
   - **prototype** — spikes, POCs, throwaway exploration
   - **write_docs** — PRDs, RFCs, READMEs, design docs, copy/doc review

   Categories describe the *type of task*, not the project or domain — a teammate on any project should recognize them. Review sessions belong with whatever's being reviewed: code review is improve_quality, doc review is write_docs, design review is plan_design. Most sessions fit the list; only invent a new category if it's genuinely a different type of task. Pick the top 3-5 with rough percentages. First messages alone are usually enough; titles and code-review links are enrichment. If first messages are uninformative, use tool and MCP counts as a weak hint. If there are ~0 sessions, leave the breakdown as a TODO.

   In the rendered guide, display categories with spaces and title case (e.g. "Build Feature" not "build_feature").

3. **Gather the remaining pieces.** For repos, start with \`currentRepo\` and check the workspace for sibling repo directories. For MCP server setup, use each entry's \`name\` (and \`urlOrigin\` where present) to infer what the server does and how a teammate would get access. Leave the Team Tips and Get Started sections as TODO placeholders — you'll ask for these in Review and fill them in after.

4. **Write the guide to \`ONBOARDING.md\`** following this template:

\`\`\`
{{GUIDE_TEMPLATE}}
\`\`\`

   Fill in real numbers from the usage data (not placeholders). Use \`generatedBy\` for the name; if it's missing, omit the name. Ascii bar charts: \`█\` for filled, \`░\` for empty, 20 chars wide. Keep the HTML comment instruction at the bottom exactly as shown.

5. **Render the guide in a code block, then close out the first turn.** You're co-authoring this guide with the guide creator — frame the follow-up as collaboration, not corrections.

   After the code block, add a \`---\` horizontal rule and a \`**Review**\` heading so the guide is visually separated from your questions. Under the heading, number these three questions:

   1. "I went with '[X]' for the team name — let me know if that sounds right." (or if you couldn't tell: "What's the team name? I'll add it in.")
   2. Is there a starter task for someone new to Claude Code? (ticket or doc link — optional)
   3. Any team tips you'd tell a new teammate that aren't already in CLAUDE.md?

   After they answer, update \`ONBOARDING.md\` with their team name, tips, and starter task. Then close with this exact line (not numbered, not paraphrased):

   Saved to \`ONBOARDING.md\`. Drop it in your team docs and channels — when a new teammate pastes it into Claude Code, they get a guided onboarding tour from there.

   Apply any edits they come back with to the file.`

const COMMAND_NAME_RE = new RegExp(`<${COMMAND_NAME_TAG}>\\s*/?([^<\\s]+)\\s*</${COMMAND_NAME_TAG}>`, 'g')

function userText(content: string | ContentBlockParam[]): string {
  if (typeof content === 'string') return content
  let out = ''
  for (const block of content) {
    if (block.type === 'text') out += block.text
  }
  return out
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function mcpServerName(toolName: string): string | null {
  if (!toolName.startsWith('mcp__')) return null
  const parts = toolName.split('__')
  return parts.length >= 3 && parts[1] ? parts[1] : null
}

type SessionDescriptor = {
  title: string
  prNumbers: number[]
  firstUserMessage: string
}

type UsageScan = {
  usageData: string
  sessionCount: number
  slashCommandCount: number
  mcpServerCount: number
}

async function scanUsage(windowDays: number): Promise<UsageScan> {
  const logs = await loadMessageLogs()
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000
  const inWindow = logs.filter((log) => log.modified.getTime() >= cutoff)

  const slashTotals = new Map<string, number>()
  const mcpTotals = new Map<string, number>()
  const sessionDescriptors: SessionDescriptor[] = []

  for (const log of inWindow) {
    for (const msg of log.messages) {
      if (msg.type === 'user') {
        const text = userText(msg.message.content)
        for (const match of text.matchAll(COMMAND_NAME_RE)) {
          const name = match[1]?.replace(/^\//, '')
          if (name) increment(slashTotals, `/${name}`)
        }
      } else if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'tool_use' && 'name' in block && typeof block.name === 'string') {
            const server = mcpServerName(block.name)
            if (server) increment(mcpTotals, server)
          }
        }
      }
    }
  }

  const prAware = inWindow.filter((log) => typeof log.prNumber === 'number')
  for (const log of prAware.length > 0 ? prAware : inWindow) {
    if (sessionDescriptors.length >= 100) break
    sessionDescriptors.push({
      title: log.customTitle ?? log.summary ?? (log.firstPrompt || 'Untitled session'),
      prNumbers: typeof log.prNumber === 'number' ? [log.prNumber] : [],
      firstUserMessage: log.firstPrompt,
    })
  }

  const [repoResult, userResult] = await Promise.all([
    detectCurrentRepositoryWithHost(),
    execFileNoThrow(gitExe(), ['config', 'user.name'], { preserveOutputOnError: false }),
  ])
  const generatedBy = userResult.stdout.trim() || undefined
  const currentRepo = repoResult ? `${repoResult.owner}/${repoResult.name}` : undefined

  const usage = {
    generatedBy,
    currentRepo,
    windowDays,
    sessionCount: inWindow.length,
    slashCommands: [...slashTotals.entries()].toSorted((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    mcpServers: [...mcpTotals.entries()]
      .toSorted((a, b) => b[1] - a[1])
      .map(([name, callCount]) => ({ name, callCount })),
    sessionDescriptors,
  }

  return {
    usageData: JSON.stringify(usage, null, 2),
    sessionCount: inWindow.length,
    slashCommandCount: slashTotals.size,
    mcpServerCount: mcpTotals.size,
  }
}

const teamOnboarding = {
  type: 'prompt',
  name: 'team-onboarding',
  description: 'Help teammates ramp on Claude Code with a guide from your usage',
  allowedTools: ['Edit(ONBOARDING.md)', 'Bash(ls:*)'],
  contentLength: 0,
  isEnabled: () =>
    isEnvTruthy(process.env.CLAUDE_CODE_TEAM_ONBOARDING) ||
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_flint_harbor', false),
  isHidden: false,
  progressMessage: 'scanning usage data',
  userFacingName() {
    return 'team-onboarding'
  },
  source: 'builtin',
  async getPromptForCommand(): Promise<ContentBlockParam[]> {
    const override = getFeatureValue_CACHED_MAY_BE_STALE<Record<string, unknown> | null>(
      'tengu_flint_harbor_prompt',
      null,
    )
    const o = override ?? {}
    const promptTemplate = typeof o.prompt === 'string' ? o.prompt : PROMPT_TEMPLATE
    const guideTemplate = typeof o.guideTemplate === 'string' ? o.guideTemplate : GUIDE_TEMPLATE
    const windowDays =
      typeof o.windowDays === 'number'
        ? Math.min(Math.max(Math.floor(o.windowDays), 1), MAX_WINDOW_DAYS)
        : DEFAULT_WINDOW_DAYS
    logEvent('tengu_team_onboarding_invoked', { window_days: windowDays })

    const { usageData, sessionCount, slashCommandCount, mcpServerCount } = await scanUsage(windowDays)
    const text = promptTemplate
      .replaceAll('{{WINDOW_DAYS}}', String(windowDays))
      .replaceAll('{{GUIDE_TEMPLATE}}', guideTemplate)
      .replaceAll('{{USAGE_DATA}}', usageData)
    logEvent('tengu_team_onboarding_generated', {
      session_count: sessionCount,
      slash_command_count: slashCommandCount,
      mcp_server_count: mcpServerCount,
      window_days: windowDays,
    })
    return [{ type: 'text', text }]
  },
} satisfies Command

export default teamOnboarding
