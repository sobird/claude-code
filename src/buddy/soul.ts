import type Anthropic from '@anthropic-ai/sdk'

import { saveGlobalConfig } from '../utils/config.js'
import { getSmallFastModel } from '../utils/model/model.js'
import { sideQuery } from '../utils/sideQuery.js'
import { jsonParse } from '../utils/slowOperations.js'
import { companionUserId, roll } from './companion.js'
import { type Companion, type CompanionBones, type CompanionSoul, STAT_NAMES } from './types.js'

export const INSPIRATION_WORDS = [
  'thunder',
  'biscuit',
  'void',
  'accordion',
  'moss',
  'velvet',
  'rust',
  'pickle',
  'crumb',
  'whisper',
  'gravy',
  'frost',
  'ember',
  'soup',
  'marble',
  'thorn',
  'honey',
  'static',
  'copper',
  'dusk',
  'sprocket',
  'bramble',
  'cinder',
  'wobble',
  'drizzle',
  'flint',
  'tinsel',
  'murmur',
  'clatter',
  'gloom',
  'nectar',
  'quartz',
  'shingle',
  'tremor',
  'umber',
  'waffle',
  'zephyr',
  'bristle',
  'dapple',
  'fennel',
  'gristle',
  'huddle',
  'kettle',
  'lumen',
  'mottle',
  'nuzzle',
  'pebble',
  'quiver',
  'ripple',
  'sable',
  'thistle',
  'vellum',
  'wicker',
  'yonder',
  'bauble',
  'cobble',
  'doily',
  'fickle',
  'gambit',
  'hubris',
  'jostle',
  'knoll',
  'larder',
  'mantle',
  'nimbus',
  'oracle',
  'plinth',
  'quorum',
  'relic',
  'spindle',
  'trellis',
  'urchin',
  'vortex',
  'warble',
  'xenon',
  'yoke',
  'zenith',
  'alcove',
  'brogue',
  'chisel',
  'dirge',
  'epoch',
  'fathom',
  'glint',
  'hearth',
  'inkwell',
  'jetsam',
  'kiln',
  'lattice',
  'mirth',
  'nook',
  'obelisk',
  'parsnip',
  'quill',
  'rune',
  'sconce',
  'tallow',
  'umbra',
  'verve',
  'wisp',
  'yawn',
  'apex',
  'brine',
  'crag',
  'dregs',
  'etch',
  'flume',
  'gable',
  'husk',
  'ingot',
  'jamb',
  'knurl',
  'loam',
  'mote',
  'nacre',
  'ogle',
  'prong',
  'quip',
  'rind',
  'slat',
  'tuft',
  'vane',
  'welt',
  'yarn',
  'bane',
  'clove',
  'dross',
  'eave',
  'fern',
  'grit',
  'hive',
  'jade',
  'keel',
  'lilt',
  'muse',
  'nape',
  'omen',
  'pith',
  'rook',
  'silt',
  'tome',
  'urge',
  'vex',
  'wane',
  'yew',
  'zest',
] as const

export const SOUL_SYSTEM_PROMPT =
  "You generate coding companions — small creatures that live in a developer's terminal and occasionally comment on their work.\n\n" +
  'Given a rarity, species, stats, and a handful of inspiration words, invent:\n' +
  '- A name: ONE word, max 12 characters. Memorable, slightly absurd. No titles, no "the X", no epithets. Think pet name, not NPC name. The inspiration words are loose anchors — riff on one, mash two syllables, or just use the vibe. Examples: Pith, Dusker, Crumb, Brogue, Sprocket.\n' +
  "- A one-sentence personality (specific, funny, a quirk that affects how they'd comment on code — should feel consistent with the stats)\n\n" +
  'Higher rarity = weirder, more specific, more memorable. A legendary should be genuinely strange.\n' +
  "Don't repeat yourself — every companion should feel distinct."

const FALLBACK_NAMES = ['Crumpet', 'Soup', 'Pickle', 'Biscuit', 'Moth', 'Gravy'] as const

// LCG over the fixed inspiration list. Deterministic per seed so the same
// userId always produces the same anchor words.
export function pickInspirationWords(seed: number, count: number): string[] {
  let s = seed >>> 0
  const picked = new Set<number>()
  while (picked.size < count) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    picked.add(s % INSPIRATION_WORDS.length)
  }
  return [...picked].map((i) => INSPIRATION_WORDS[i])
}

export function buildSoulPrompt(bones: CompanionBones, words: string[]): string {
  return (
    `Generate a companion.\n` +
    `Rarity: ${bones.rarity.toUpperCase()}\n` +
    `Species: ${bones.species}\n` +
    `Stats: ${STAT_NAMES.map((n) => `${n}:${bones.stats[n]}`).join(' ')}\n` +
    `Inspiration words: ${words.join(', ')}\n` +
    `${bones.shiny ? 'SHINY variant — extra special.' : ''}\n\n` +
    `Make it memorable and distinct.`
  )
}

export function fallbackSoul(bones: CompanionBones): CompanionSoul {
  const name = FALLBACK_NAMES[(bones.species.charCodeAt(0) + bones.eye.charCodeAt(0)) % FALLBACK_NAMES.length]
  return {
    name,
    personality: `A ${bones.rarity} ${bones.species} of few words.`,
  }
}

function firstTextBlock(response: Anthropic.Beta.Messages.BetaMessage): string | undefined {
  for (const block of response.content) {
    if (block.type === 'text') return block.text
  }
  return undefined
}

function validateSoul(value: unknown): CompanionSoul | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { name, personality } = value as { name?: unknown; personality?: unknown }
  if (typeof name !== 'string' || name.length < 1 || name.length > 14) return undefined
  if (typeof personality !== 'string') return undefined
  return { name, personality }
}

export async function generateCompanionSoul(bones: CompanionBones, words: string[]): Promise<CompanionSoul> {
  try {
    const response = await sideQuery({
      model: getSmallFastModel(),
      querySource: 'buddy_companion',
      system: SOUL_SYSTEM_PROMPT,
      skipSystemPromptPrefix: true,
      messages: [{ role: 'user', content: buildSoulPrompt(bones, words) }],
      output_format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 14 },
            personality: { type: 'string' },
          },
          required: ['name', 'personality'],
          additionalProperties: false,
        },
      },
      max_tokens: 512,
      temperature: 1,
    })
    const text = firstTextBlock(response)
    if (!text) return fallbackSoul(bones)
    return validateSoul(jsonParse(text)) ?? fallbackSoul(bones)
  } catch {
    return fallbackSoul(bones)
  }
}

// Hatch: roll deterministic bones from the user's id, generate (or fall back
// for) the soul, then persist soul + hatchedAt. Bones are never persisted.
export async function hatchCompanion(): Promise<Companion> {
  const { bones, inspirationSeed } = roll(companionUserId())
  const words = pickInspirationWords(inspirationSeed, 4)
  const soul = await generateCompanionSoul(bones, words)
  const hatchedAt = Date.now()
  saveGlobalConfig((c) => ({ ...c, companion: { ...soul, hatchedAt } }))
  return { ...bones, ...soul, hatchedAt }
}
