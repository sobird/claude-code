import React, { useEffect, useState } from 'react'

import { getCompanion } from '../../buddy/companion.js'
import { hatchCompanion } from '../../buddy/soul.js'
import { renderSprite } from '../../buddy/sprites.js'
import { type Companion, RARITY_COLORS, RARITY_STARS, STAT_NAMES } from '../../buddy/types.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { Box, Text, useInput } from '../../ink.js'
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { getRainbowColor } from '../../utils/thinking.js'
import { isBuddyCommandVisible } from './index.js'

function CompanionPanel({
  companion,
  onDone,
}: {
  companion: Companion
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  useInput(() => onDone(), { isActive: true })
  const color = RARITY_COLORS[companion.rarity]
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color}
      paddingX={2}
      paddingY={1}
      width={40}
      flexShrink={0}
    >
      <Box justifyContent="space-between">
        <Text bold color={color}>
          {RARITY_STARS[companion.rarity]} {companion.rarity.toUpperCase()}
        </Text>
        <Text color={color}>{companion.species.toUpperCase()}</Text>
      </Box>
      {companion.shiny && (
        <Text color="warning" bold>
          ✨ SHINY ✨
        </Text>
      )}
      {renderSprite(companion).map((line) => (
        <Text key={line} color={color}>
          {line}
        </Text>
      ))}
      <Text bold>{companion.name}</Text>
      <Box marginY={1}>
        <Text dimColor italic>{`"${companion.personality}"`}</Text>
      </Box>
      <Box flexDirection="column">
        {STAT_NAMES.map((name) => {
          const value = companion.stats[name]
          const filled = Math.round(value / 10)
          return (
            <Text key={name} dimColor>
              {`${name.padEnd(10)} ${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${String(value).padStart(3)}`}
            </Text>
          )
        })}
      </Box>
    </Box>
  )
}

const PLAIN_EGG = [
  '    _____    ',
  '   /     \\   ',
  '  /       \\  ',
  ' |         | ',
  '  \\       /  ',
  '   \\_____/   ',
]

const EGG_FRAMES: Array<{ offset: number; lines: string[] }> = [
  { offset: 0, lines: PLAIN_EGG },
  { offset: 1, lines: PLAIN_EGG },
  { offset: -1, lines: PLAIN_EGG },
  { offset: 1, lines: PLAIN_EGG },
  {
    offset: 0,
    lines: ['    _____    ', '   /     \\   ', '  /       \\  ', ' |    .    | ', '  \\       /  ', '   \\_____/   '],
  },
  {
    offset: -1,
    lines: ['    _____    ', '   /     \\   ', '  /       \\  ', ' |    ∕    | ', '  \\       /  ', '   \\_____/   '],
  },
  {
    offset: 1,
    lines: ['    _____    ', '   /     \\   ', '  /   .   \\  ', ' |   ∕ \\   | ', '  \\       /  ', '   \\_____/   '],
  },
  {
    offset: 0,
    lines: ['    _____    ', '   /  .  \\   ', '  /  ∕ \\  \\  ', ' |  ∕   \\  | ', '  \\   .   /  ', '   \\_____/   '],
  },
  {
    offset: -1,
    lines: [
      '    _____    ',
      '   / ∕ \\ \\   ',
      '  / ∕   \\ \\  ',
      ' | ∕     \\ | ',
      '  \\   ∨   /  ',
      '   \\__∨__/   ',
    ],
  },
  {
    offset: 1,
    lines: ['    __ __    ', '   / V V \\   ', '  / ∕   \\ \\  ', ' | ∕     \\ | ', '  \\   ∨   /  ', '   \\__∨__/   '],
  },
  {
    offset: 0,
    lines: ['   ·  ✦  ·   ', '  ·       ·  ', ' ·    ✦    · ', '  ✦       ✦  ', ' ·    ·    · ', '   ·  ✦  ·   '],
  },
]

function HatchingPanel({
  hatching,
  onDone,
}: {
  hatching: Promise<Companion>
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  const { columns } = useTerminalSize()
  const [tick, setTick] = useState(0)
  const [hatched, setHatched] = useState<Companion | null>(null)
  const [doneTick, setDoneTick] = useState<number | null>(null)
  const [final, setFinal] = useState<Companion | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 160)
    void hatching.then(setHatched)
    return () => clearInterval(timer)
  }, [hatching])

  useEffect(() => {
    if (hatched !== null && doneTick === null && tick >= 12) setDoneTick(tick)
  }, [hatched, doneTick, tick])

  const frameIndex = doneTick === null ? tick % 4 : tick - doneTick < 7 ? 4 + (tick - doneTick) : EGG_FRAMES.length - 1

  useEffect(() => {
    if (frameIndex === EGG_FRAMES.length - 1 && final === null && hatched !== null) setFinal(hatched)
  }, [frameIndex, final, hatched])

  if (final) {
    return (
      <Box flexDirection="column">
        <CompanionPanel companion={final} onDone={onDone} />
        <Text dimColor>{`${final.name} is here · it'll chime in as you code`}</Text>
        <Text dimColor>your buddy won't count toward your usage</Text>
        <Text dimColor>say its name to get its take · /buddy pet · /buddy off</Text>
        <Box marginTop={1}>
          <Text dimColor>press any key</Text>
        </Box>
      </Box>
    )
  }

  const frame = EGG_FRAMES[frameIndex]
  const prefix = ' '.repeat(1 + frame.offset)
  const suffix = ' '.repeat(1 - frame.offset)
  return (
    <Box flexDirection="column" alignItems="center" width={columns}>
      <Box flexDirection="column" borderStyle="round" borderColor={getRainbowColor(tick)} paddingY={1}>
        {frame.lines.map((line) => (
          <Text key={line}>
            {prefix}
            {line}
            {suffix}
          </Text>
        ))}
      </Box>
      <Text dimColor>hatching a coding buddy…</Text>
      <Text dimColor>it'll watch you work and occasionally have opinions</Text>
    </Box>
  )
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode> {
  const config = getGlobalConfig()
  const trimmed = args?.trim()

  if (trimmed === 'off') {
    if (!config.companionMuted) {
      saveGlobalConfig((c) => ({ ...c, companionMuted: true }))
    }
    onDone('companion muted', { display: 'system' })
    return null
  }

  if (trimmed === 'on') {
    if (config.companionMuted) {
      saveGlobalConfig((c) => ({ ...c, companionMuted: false }))
    }
    onDone('companion unmuted', { display: 'system' })
    return null
  }

  // The command is hidden when unavailable, but /buddy can still be reached
  // through a saved prompt or an alias — fail with a clear message instead of
  // hatching a companion for a configuration that does not support it.
  if (!isBuddyCommandVisible()) {
    onDone('buddy is unavailable on this configuration', { display: 'system' })
    return null
  }

  if (trimmed === 'pet') {
    const companion = getCompanion()
    if (!companion) {
      onDone('no companion yet · run /buddy first', { display: 'system' })
      return null
    }
    if (config.companionMuted === true) {
      saveGlobalConfig((c) => ({ ...c, companionMuted: false }))
    }
    context.setAppState((s) => ({ ...s, companionPetAt: Date.now() }))
    onDone(`petted ${companion.name}`, { display: 'system' })
    return null
  }

  if (config.companionMuted === true) {
    saveGlobalConfig((c) => ({ ...c, companionMuted: false }))
  }
  const companion = getCompanion()
  if (companion) return <CompanionPanel companion={companion} onDone={onDone} />

  const hatching = hatchCompanion()
  return <HatchingPanel hatching={hatching} onDone={onDone} />
}
