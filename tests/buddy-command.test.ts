import { expect, test } from 'bun:test'

import { features } from '../scripts/config'
import { fallbackSoul, INSPIRATION_WORDS, pickInspirationWords } from '../src/buddy/soul'
import { type CompanionBones, duck } from '../src/buddy/types'
import buddy from '../src/commands/buddy/index'

test('buddy enabled with 2.1.89 copy', () => {
  expect(features).toContain('BUDDY')
  expect(buddy.name).toBe('buddy')
  expect(buddy.description.toLowerCase()).toContain('companion')
  expect(buddy.description).toBe('Hatch a coding companion · pet, off')
  expect(buddy.type).toBe('local-jsx')
  expect(buddy.immediate).toBe(true)
})

test('pickInspirationWords is deterministic and yields unique values', () => {
  const first = pickInspirationWords(12345, 4)
  const second = pickInspirationWords(12345, 4)
  expect(first).toEqual(second)
  expect(first).toHaveLength(4)
  expect(new Set(first).size).toBe(4)
  const words: readonly string[] = INSPIRATION_WORDS
  for (const word of first) {
    expect(words).toContain(word)
  }
})

test('fallbackSoul derives a name and personality from bones', () => {
  const bones: CompanionBones = {
    rarity: 'legendary',
    species: duck,
    eye: '·',
    hat: 'none',
    shiny: false,
    stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
  }
  const soul = fallbackSoul(bones)
  expect(['Crumpet', 'Soup', 'Pickle', 'Biscuit', 'Moth', 'Gravy']).toContain(soul.name)
  expect(soul.personality).toBe('A legendary duck of few words.')
})
