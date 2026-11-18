import figures from 'figures'
import * as React from 'react'

import { type OptionWithDescription, Select } from '../../components/CustomSelect/select.js'
import { Byline } from '../../components/design-system/Byline.js'
import { KeyboardShortcutHint } from '../../components/design-system/KeyboardShortcutHint.js'
import { ProgressBar } from '../../components/design-system/ProgressBar.js'
import { StatusIcon } from '../../components/design-system/StatusIcon.js'
import { useSettings } from '../../hooks/useSettings.js'
import { Box, Text, useAnimationFrame } from '../../ink.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js'
import { logEvent } from '../../services/analytics/index.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import type { Theme } from '../../utils/theme.js'

export type PowerupId =
  | 'at-mentions'
  | 'modes'
  | 'undo'
  | 'background'
  | 'memory'
  | 'mcp'
  | 'automate'
  | 'subagents'
  | 'cross-device'
  | 'model-dial'

type PowerupLesson = {
  id: PowerupId
  title: string
  tagline: string
  body: React.ReactNode
}

/** Bold, accent-colored inline token (a key or command name). */
function Code({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <Text bold color="claude">
      {children}
    </Text>
  )
}

/** Suggestion-colored inline token (a command or switch). */
function Suggestion({ children }: { children: React.ReactNode }): React.ReactNode {
  return <Text color="suggestion">{children}</Text>
}

// Demo frames use "[color:text]" for colored spans and a leading "#" to mark
// the line as dimmed context.
const DEMO_MARKUP_PATTERN = /\[(\w+):([^\]]*)\]/g

export type DemoSegment = { text: string; color?: keyof Theme }
export type DemoLine = { dim: boolean; segments: DemoSegment[] }

export function parseDemoText(frame: string): DemoLine[] {
  return frame.split('\n').map((rawLine) => {
    const dim = rawLine.startsWith('#')
    const line = dim ? rawLine.slice(1) : rawLine
    const segments: DemoSegment[] = []
    let cursor = 0
    for (const match of line.matchAll(DEMO_MARKUP_PATTERN)) {
      const index = match.index ?? 0
      if (index > cursor) {
        segments.push({ text: line.slice(cursor, index) })
      }
      segments.push({ text: match[2], color: match[1] as keyof Theme })
      cursor = index + match[0].length
    }
    if (cursor < line.length) {
      segments.push({ text: line.slice(cursor) })
    }
    if (segments.length === 0) {
      segments.push({ text: '' })
    }
    return { dim, segments }
  })
}

const DEMO_FRAME_MS = 3000
const DEMO_WIDTH = 48
const DEMO_HEIGHT = 3

/**
 * A small bordered terminal mock-up that cycles through static frames. Upstream
 * animates these in place; we keep the same frames and cadence, and freeze on
 * the first frame when the user prefers reduced motion.
 */
function Demo({ frames }: { frames: string[] }): React.ReactNode {
  const settings = useSettings()
  const reducedMotion = settings.prefersReducedMotion ?? false
  const [ref, time] = useAnimationFrame(reducedMotion ? null : DEMO_FRAME_MS)
  const frameIndex = reducedMotion ? 0 : Math.floor(time / DEMO_FRAME_MS) % frames.length
  const lines = parseDemoText(frames[frameIndex] ?? '')

  return (
    <Box
      ref={ref}
      flexDirection="column"
      borderStyle="round"
      borderColor="inactive"
      paddingX={1}
      width={DEMO_WIDTH}
      height={DEMO_HEIGHT + 2}
    >
      <Box flexDirection="column" width={DEMO_WIDTH - 4} height={DEMO_HEIGHT}>
        {lines.map((line, index) => (
          <Text key={index} dimColor={line.dim}>
            {line.segments.map((segment, segmentIndex) => (
              <Text key={segmentIndex} color={segment.color}>
                {segment.text}
              </Text>
            ))}
          </Text>
        ))}
      </Box>
      <Box position="absolute" marginLeft={DEMO_WIDTH - 10}>
        <Text dimColor>▶ demo</Text>
      </Box>
    </Box>
  )
}

const MODE_DEMO_STATES = [
  { label: 'default', symbol: '', color: 'text' },
  { label: 'accept edits on', symbol: '⏵⏵', color: 'autoAccept' },
  { label: 'plan mode on', symbol: '⏸', color: 'planMode' },
  { label: 'auto mode on', symbol: '⏵⏵', color: 'warning' },
] as const satisfies readonly { label: string; symbol: string; color: keyof Theme }[]

/** Live shift+tab demo: press the bound key and the mode indicator cycles. */
function ModeDemo(): React.ReactNode {
  const [index, setIndex] = React.useState(0)
  const state = MODE_DEMO_STATES[index]
  const cycleShortcut = useShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab')
  const [ref] = useAnimationFrame(16)
  useKeybindings(
    { 'confirm:cycleMode': () => setIndex((current) => (current + 1) % MODE_DEMO_STATES.length) },
    { context: 'Confirmation' },
  )

  const symbol = state.symbol ? `${state.symbol} ` : '  '
  return (
    <Box ref={ref} borderStyle="round" borderColor="inactive" paddingX={1}>
      <Box flexDirection="column">
        <Text dimColor>Press {cycleShortcut} now</Text>
        <Text color={state.color}>
          {symbol}
          {state.label}
        </Text>
      </Box>
    </Box>
  )
}

const POWERUP_LESSONS: PowerupLesson[] = [
  {
    id: 'at-mentions',
    title: 'Talk to your codebase',
    tagline: '@ files, line refs',
    body: (
      <Box flexDirection="column" gap={1}>
        <Text>
          Type <Code>@</Code> anywhere in your prompt to fuzzy-find and attach a file. Claude reads it before answering
          — no more pasting code.
        </Text>
        <Demo
          frames={[
            '> what does [suggestion:@]\n#type a file name…',
            '> what does [suggestion:@src/auth.ts]\n  [suggestion:❯ src/auth.ts]\n#   src/auth.test.ts',
            '> what does [suggestion:@src/auth.ts] do?\n#◐ Reading src/auth.ts…',
            '> what does [suggestion:@src/auth.ts] do?\nExports validateToken() which\nchecks JWT expiry and signature.',
          ]}
        />
        <Text>
          Reference specific lines with <Suggestion>src/app.ts:42</Suggestion> and Claude jumps straight there. Works in
          both directions: Claude cites files the same way, so you can click to open them in your editor.
        </Text>
        <Text dimColor>
          Also try: <Suggestion>@folder/</Suggestion> to attach a whole directory tree.
        </Text>
      </Box>
    ),
  },
  {
    id: 'modes',
    title: 'Steer with modes',
    tagline: 'shift+tab, plan, auto',
    body: (
      <Box flexDirection="column" gap={1}>
        <Text>
          Press <Code>shift+tab</Code> to cycle permission modes. Each mode changes how much Claude asks before acting:
        </Text>
        <ModeDemo />
        <Box flexDirection="column" paddingLeft={2}>
          <Text>
            <Text color="success">default</Text> — ask before every edit
          </Text>
          <Text>
            <Text color="autoAccept">accept edits</Text> — edit freely, ask for commands
          </Text>
          <Text>
            <Text color="planMode">plan</Text> — research and propose, never touch files
          </Text>
          <Text>
            <Text color="warning">auto</Text> — Claude decides what is safe
          </Text>
        </Box>
        <Text dimColor>
          Use <Text color="planMode">plan</Text> for big refactors you want to review first. Use{' '}
          <Text color="warning">auto</Text> for long unattended tasks. Run <Suggestion>/permissions</Suggestion> to
          pre-allow specific commands so Claude stops asking about them.
        </Text>
      </Box>
    ),
  },
  {
    id: 'undo',
    title: 'Undo anything',
    tagline: '/rewind, Esc-Esc',
    body: (
      <Box flexDirection="column" gap={1}>
        <Text>
          Claude checkpoints your files before every edit. Press <Code>Esc Esc</Code> (double-tap) to open{' '}
          <Suggestion>/rewind</Suggestion> and roll back to any prior state — code, conversation, or both.
        </Text>
        <Demo
          frames={[
            '[success:✓] Updated regex in parser.ts\n#[error:8 tests failing]',
            '#press Esc Esc\nRewind to:\n  [suggestion:❯ before parser.ts edit]',
            '#[success:✓] parser.ts restored\n> try a simpler approach\n#◐ thinking…',
          ]}
        />
        <Text>
          Went down the wrong path? Rewind to before the detour and try a different prompt. Your git history stays
          clean.
        </Text>
        <Text dimColor>
          Also: <Suggestion>/clear</Suggestion> wipes conversation but keeps files. <Suggestion>/branch</Suggestion>{' '}
          forks the conversation to try two approaches.
        </Text>
      </Box>
    ),
  },
  {
    id: 'background',
    title: 'Run in the background',
    tagline: 'tasks, /tasks',
    body: (
      <Box flexDirection="column" gap={1}>
        <Text>
          Long builds and test suites do not have to block you. Add <Code>&</Code> to any bash command and it runs in
          the background — you keep chatting, Claude notifies you when it finishes.
        </Text>
        <Demo
          frames={[
            '> run the test suite [claude:&]\n#task started in background',
            '> now fix the lint in app.ts\n#◐ Editing app.ts…\n#[warning:◐] bun test · 12s',
            '> now fix the lint in app.ts\n[success:✓] Removed unused import\n#[warning:◐] bun test · 28s',
            '> now fix the lint in app.ts\n[success:✓] Removed unused import\n#[success:✓] bun test · 284 pass',
          ]}
        />
        <Text>
          Run <Suggestion>/tasks</Suggestion> to see everything in flight. Claude can read task output mid-run and react
          to failures automatically.
        </Text>
        <Text dimColor>Subagents and workflows also run as tasks — it is all one queue.</Text>
      </Box>
    ),
  },
  {
    id: 'memory',
    title: 'Teach Claude your rules',
    tagline: 'CLAUDE.md, /memory',
    body: (
      <Box flexDirection="column" gap={1}>
        <Text>
          Drop a <Suggestion>CLAUDE.md</Suggestion> file in your repo and Claude reads it at the start of every session.
          Put your conventions there: test commands, style rules, do-not-touch directories.
        </Text>
        <Demo
          frames={[
            '#─ CLAUDE.md ─\n#Run tests with: [suggestion:bun test]\n#Never edit src/legacy/',
            '> add tests for the cache\n#◐ reading CLAUDE.md…',
            '> add tests for the cache\nWriting cache.test.ts,\nrunning [suggestion:bun test] to verify.',
          ]}
        />
        <Text>
          Run <Suggestion>/init</Suggestion> to generate a starter CLAUDE.md from your codebase. Run{' '}
          <Suggestion>/memory</Suggestion> to edit it inline.
        </Text>
        <Text dimColor>
          Works at three levels: repo, your home directory (all projects), and per-directory overrides.
        </Text>
      </Box>
    ),
  },
  {
    id: 'mcp',
    title: 'Extend with tools',
    tagline: 'MCP, /mcp',
    body: (
      <Box flexDirection="column" gap={1}>
        <Text>
          MCP servers give Claude new tools: read your Slack, query your database, control your browser. Run{' '}
          <Suggestion>/mcp</Suggestion> to browse and connect servers.
        </Text>
        <Demo
          frames={[
            '> [suggestion:/mcp]\nConnected servers:\n  [success:✓] slack    [success:✓] github',
            '> anything urgent in #eng?\n#◐ [suggestion:slack] · reading channel…',
            'Boris posted about the merge\nfreeze. Also 3 PRs await\nyour review on github.',
          ]}
        />
        <Text>
          Once connected, tools appear automatically — ask Claude to "check my calendar" or "search our Notion" and it
          just works.
        </Text>
        <Text dimColor>
          From your shell: <Suggestion>claude mcp add my-server -- npx some-mcp-pkg</Suggestion> to wire one up without
          leaving the terminal.
        </Text>
      </Box>
    ),
  },
  {
    id: 'automate',
    title: 'Automate your workflow',
    tagline: 'skills, hooks',
    body: (
      <Box flexDirection="column" gap={1}>
        <Text>
          Save a prompt to <Suggestion>.claude/skills/deploy/SKILL.md</Suggestion> and it becomes{' '}
          <Suggestion>/deploy</Suggestion> — type it, Claude runs it. Run <Suggestion>/skills</Suggestion> to see what
          you have.
        </Text>
        <Demo
          frames={[
            '> [suggestion:/deploy] staging\n#◐ skill: deploy',
            '[success:✓] built\n[success:✓] tests pass\n#◐ pushing to staging…',
            '[success:✓] deployed\n#[suggestion:staging.app.com]\n#PostToolUse hook ran prettier',
          ]}
        />
        <Text>
          Hooks run your own scripts on events: before a tool call, after a response, on session start. Use them to
          enforce rules, log activity, or inject context. Run <Suggestion>/hooks</Suggestion> to see what fires when.
        </Text>
        <Text dimColor>
          Run <Suggestion>/install-github-app</Suggestion> to let Claude review PRs when tagged.
        </Text>
      </Box>
    ),
  },
  {
    id: 'subagents',
    title: 'Multiply yourself',
    tagline: 'subagents, /agents',
    body: (
      <Box flexDirection="column" gap={1}>
        <Text>
          Claude can spawn copies of itself to work in parallel. Ask it to "use subagents to search these 5 directories"
          and watch the fan-out.
        </Text>
        <Demo
          frames={[
            '> find any error handling bugs\n#◐ Spawning 3 agents…',
            '#[warning:◐] agent-1 · scanning api\n#[warning:◐] agent-2 · scanning utils\n#[warning:◐] agent-3 · scanning cli',
            '#[success:✓] agent-1 · found reject\n#[warning:◐] agent-2 · scanning utils\n#[success:✓] agent-3 · no issues',
            'Found 2 issues:\n  [suggestion:api/fetch.ts:42] unhandled\n  [suggestion:utils/retry.ts:18] swallowed',
          ]}
        />
        <Text>
          Define specialized agents in <Suggestion>.claude/agents/</Suggestion> — a test runner, a code reviewer, a docs
          writer — each with its own tools and instructions. Run <Suggestion>/agents</Suggestion> to manage them.
        </Text>
        <Text dimColor>
          Subagents run in isolated context. For true parallel sessions on separate branches, launch with{' '}
          <Suggestion>claude --worktree</Suggestion>.
        </Text>
      </Box>
    ),
  },
  {
    id: 'cross-device',
    title: 'Code from anywhere',
    tagline: '/remote-control, /teleport',
    body: (
      <Box flexDirection="column" gap={1}>
        <Text>
          Run <Suggestion>/remote-control</Suggestion> and this terminal becomes visible on your phone and at
          claude.ai/code. Watch output, send prompts, approve tool calls — all from another device while this session
          keeps running.
        </Text>
        <Demo
          frames={[
            '> [suggestion:/remote-control]\n#◐ connecting…',
            '[success:✓] connected\nsee this session at\n[suggestion:claude.ai/code/abc123]',
            '#─ on your phone ─\n#abc123 · running tests\n[warning:◐] 142 of 284',
            '#─ on your phone ─\n#abc123 · [success:✓] all pass\n> ship it',
          ]}
        />
        <Text>
          Started a session on the web and want to move it here? Run <Suggestion>/teleport</Suggestion> to pull it into
          this terminal with full history.
        </Text>
        <Text dimColor>Kick off a long task, close your laptop, check progress from your phone.</Text>
      </Box>
    ),
  },
  {
    id: 'model-dial',
    title: 'Dial the model',
    tagline: '/model, /effort',
    body: (
      <Box flexDirection="column" gap={1}>
        <Text>
          Run <Suggestion>/model</Suggestion> to switch models. Opus for hard problems, Sonnet for most work, Haiku for
          quick questions. Each trades speed for depth.
        </Text>
        <Demo
          frames={[
            '> [suggestion:/effort] high\n#effort set to [claude:high]',
            '> why is the list page slow?\n#[claude:◐ thinking deeply…]',
            'Three hypotheses, ranked:\n 1. N+1 query in loader\n 2. missing index on users',
          ]}
        />
        <Text>
          <Suggestion>/effort</Suggestion> controls how long Claude thinks before answering. <Code>high</Code> for
          tricky bugs, <Code>low</Code> when you just need a quick edit.
        </Text>
        <Text dimColor>
          Also: <Suggestion>/fast</Suggestion> toggles fast mode — same model, faster output.
        </Text>
      </Box>
    ),
  },
]

export { POWERUP_LESSONS }

// "All powered up" shimmer — a two-character highlight sweeps across the text.
function ShimmerText({ text }: { text: string }): React.ReactNode {
  const settings = useSettings()
  const reducedMotion = settings.prefersReducedMotion ?? false
  const [ref, time] = useAnimationFrame(reducedMotion ? null : 80)
  const cycle = text.length + 20
  const position = reducedMotion ? -100 : (Math.floor(time / 80) % cycle) - 10
  const before = text.slice(0, Math.max(0, position))
  const shimmer = text.slice(Math.max(0, position), Math.max(0, position) + 2)
  const after = text.slice(Math.max(0, position) + 2)

  return (
    <Box ref={ref}>
      <Text bold color="claude">
        {before}
      </Text>
      <Text bold color="claudeShimmer">
        {shimmer}
      </Text>
      <Text bold color="claude">
        {after}
      </Text>
    </Box>
  )
}

export function getUnlockedPowerupIds(saved: string[] | undefined): PowerupId[] {
  if (!saved) return []
  const known = new Set<string>(POWERUP_LESSONS.map((lesson) => lesson.id))
  return saved.filter((id): id is PowerupId => known.has(id))
}

function LessonDetail({
  lesson,
  isUnlocked,
  onDone,
  onBack,
}: {
  lesson: PowerupLesson
  isUnlocked: boolean
  onDone: () => void
  onBack: () => void
}): React.ReactNode {
  useKeybindings({ 'confirm:yes': onDone, 'confirm:no': onBack }, { context: 'Confirmation' })

  return (
    <Box flexDirection="column" gap={1}>
      <Box>
        <StatusIcon status={isUnlocked ? 'success' : 'pending'} withSpace />
        <Text bold color="claude">
          {lesson.title}
        </Text>
      </Box>
      {lesson.body}
      <Text dimColor italic>
        <Byline>
          <KeyboardShortcutHint shortcut="Enter" action="mark done" />
          <KeyboardShortcutHint shortcut="Esc" action="back" />
        </Byline>
      </Text>
    </Box>
  )
}

function LessonList({
  unlocked,
  focusId,
  onOpen,
  onExit,
}: {
  unlocked: Set<PowerupId>
  focusId: PowerupId
  onOpen: (id: PowerupId) => void
  onExit: () => void
}): React.ReactNode {
  const allUnlocked = unlocked.size === POWERUP_LESSONS.length
  const options: OptionWithDescription<PowerupId>[] = POWERUP_LESSONS.map((lesson) => {
    const done = unlocked.has(lesson.id)
    const label = `${done ? figures.tick : figures.circle} ${lesson.title}`
    return {
      label: done ? <Text color="success">{label}</Text> : label,
      value: lesson.id,
      description: lesson.tagline,
    }
  })

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        {allUnlocked ? (
          <ShimmerText text="All powered up" />
        ) : (
          <Text bold color="claude">
            Power-ups
          </Text>
        )}
        <Text dimColor>
          {' '}
          {unlocked.size}/{POWERUP_LESSONS.length} unlocked{' '}
        </Text>
        <ProgressBar
          ratio={unlocked.size / POWERUP_LESSONS.length}
          width={16}
          fillColor="claude"
          emptyColor="inactive"
        />
      </Box>
      <Box marginBottom={1}>
        <Text dimColor wrap="wrap">
          {allUnlocked
            ? 'Now go build something.'
            : 'Each power-up teaches one thing Claude Code can do that most people miss. Open one, read it, try it, mark it done.'}
        </Text>
      </Box>
      <Select
        options={options}
        hideIndexes
        visibleOptionCount={POWERUP_LESSONS.length}
        defaultFocusValue={focusId}
        onChange={onOpen}
        onCancel={onExit}
      />
      <Box marginTop={1}>
        <Text dimColor italic>
          <Byline>
            <KeyboardShortcutHint shortcut="↑↓" action="select" />
            <KeyboardShortcutHint shortcut="Enter" action="open" />
            <KeyboardShortcutHint shortcut="Esc" action="close" />
          </Byline>
        </Text>
      </Box>
    </Box>
  )
}

export function Powerups({ onExit }: { onExit: (result: string) => void }): React.ReactNode {
  const [unlocked, setUnlocked] = React.useState<Set<PowerupId>>(
    () => new Set(getUnlockedPowerupIds(getGlobalConfig().powerupsUnlocked)),
  )
  const [openLesson, setOpenLesson] = React.useState<PowerupLesson | null>(null)
  const [focusId, setFocusId] = React.useState<PowerupId>(POWERUP_LESSONS[0].id)

  const markDone = (lesson: PowerupLesson): void => {
    if (unlocked.has(lesson.id)) {
      setOpenLesson(null)
      return
    }
    const next = new Set(unlocked).add(lesson.id)
    setUnlocked(next)
    saveGlobalConfig((current) => ({ ...current, powerupsUnlocked: [...next] }))
    logEvent('tengu_powerup_lesson_completed', {
      lesson_index: POWERUP_LESSONS.indexOf(lesson),
      unlocked_count: next.size,
      all_unlocked: next.size === POWERUP_LESSONS.length,
    })
    setOpenLesson(null)
  }

  if (openLesson) {
    return (
      <LessonDetail
        lesson={openLesson}
        isUnlocked={unlocked.has(openLesson.id)}
        onDone={() => markDone(openLesson)}
        onBack={() => setOpenLesson(null)}
      />
    )
  }

  return (
    <LessonList
      unlocked={unlocked}
      focusId={focusId}
      onOpen={(id) => {
        const lesson = POWERUP_LESSONS.find((candidate) => candidate.id === id)
        if (!lesson) return
        setFocusId(id)
        setOpenLesson(lesson)
        logEvent('tengu_powerup_lesson_opened', {
          lesson_index: POWERUP_LESSONS.indexOf(lesson),
          was_already_unlocked: unlocked.has(id),
          unlocked_count: unlocked.size,
        })
      }}
      onExit={() => onExit('Power-ups closed')}
    />
  )
}

export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode> {
  return <Powerups onExit={(result) => onDone(result, { display: 'system' })} />
}
