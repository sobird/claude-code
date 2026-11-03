import { describe, expect, test } from 'bun:test'

import { findChannelEntry } from '../src/services/mcp/channelNotification.js'
import {
  filterPermissionRelayClients,
  isChannelPermissionRelayEnabled,
  shortRequestId,
  truncateForPreview,
} from '../src/services/mcp/channelPermissions.js'
import { SettingsSchema } from '../src/utils/settings/types.js'

describe('findChannelEntry', () => {
  const channels = [
    { kind: 'server', name: 'slack' },
    { kind: 'plugin', name: 'discord', marketplace: 'anthropic', dev: false },
  ] as const

  test('matches a server entry by exact bare name', () => {
    expect(findChannelEntry('slack', channels)).toEqual({ kind: 'server', name: 'slack' })
  })

  test('matches a plugin entry via the plugin:<pluginName>:<server> convention', () => {
    expect(findChannelEntry('plugin:discord:bot', channels)).toEqual({
      kind: 'plugin',
      name: 'discord',
      marketplace: 'anthropic',
      dev: false,
    })
  })

  test('returns undefined for an unlisted server', () => {
    expect(findChannelEntry('telegram', channels)).toBeUndefined()
  })

  test('does not match a bare name against a plugin entry', () => {
    expect(findChannelEntry('discord', channels)).toBeUndefined()
  })
})

// Mirrors ID_AVOID_SUBSTRINGS in channelPermissions.ts; kept local so the test
// pins the no-offensive-substring guarantee rather than re-importing a private.
const BLOCKED_SUBSTRINGS = [
  'fuck',
  'shit',
  'cunt',
  'cock',
  'dick',
  'twat',
  'piss',
  'crap',
  'bitch',
  'whore',
  'ass',
  'tit',
  'cum',
  'fag',
  'dyke',
  'nig',
  'kike',
  'rape',
  'nazi',
  'damn',
  'poo',
  'pee',
  'wank',
  'anus',
]

describe('shortRequestId', () => {
  test('is deterministic, 5 chars, alphabet a-km-z, no blocklisted substring', () => {
    for (const toolUseID of ['toolu_abc123', 'toolu_XYZ789', 'toolu_rudeWordsHere']) {
      const id = shortRequestId(toolUseID)
      expect(id).toBe(shortRequestId(toolUseID))
      expect(id).toHaveLength(5)
      expect(id).toMatch(/^[a-km-z]{5}$/)
      for (const bad of BLOCKED_SUBSTRINGS) {
        expect(id.includes(bad)).toBe(false)
      }
    }
  })
})

describe('truncateForPreview', () => {
  test('caps serialized JSON at 200 chars plus an ellipsis', () => {
    const preview = truncateForPreview({ a: 'x'.repeat(500) })
    expect(preview).toHaveLength(201)
    expect(preview.endsWith('…')).toBe(true)
  })

  test('marks unserializable input', () => {
    expect(truncateForPreview(1n)).toBe('(unserializable)')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(truncateForPreview(circular)).toBe('(unserializable)')
  })
})

describe('filterPermissionRelayClients', () => {
  type Client = {
    type: string
    name: string
    capabilities?: { experimental?: Record<string, unknown> }
  }

  const dual = { experimental: { 'claude/channel': {}, 'claude/channel/permission': {} } }
  const channelOnly = { experimental: { 'claude/channel': {} } }
  const permissionOnly = { experimental: { 'claude/channel/permission': {} } }
  const clients: Client[] = [
    { type: 'connected', name: 'relay', capabilities: dual },
    { type: 'connected', name: 'relay', capabilities: channelOnly },
    { type: 'connected', name: 'relay', capabilities: permissionOnly },
    { type: 'connected', name: 'other', capabilities: dual },
    { type: 'pending', name: 'relay', capabilities: dual },
  ]

  test('keeps only connected, allowlisted clients declaring both capabilities', () => {
    const kept = filterPermissionRelayClients(clients, (name) => name === 'relay')
    expect(kept).toHaveLength(1)
    expect(kept[0]?.name).toBe('relay')
    expect(kept[0]?.type).toBe('connected')
  })

  test('relay gate reads a boolean from GrowthBook (default off)', () => {
    expect(typeof isChannelPermissionRelayEnabled()).toBe('boolean')
  })
})

describe('channels settings', () => {
  // `defaultView` lives in a `feature('KAIROS') || feature('KAIROS_BRIEF')`
  // spread and neither feature is compiled on for `bun test` (verified: the
  // outer schema is .passthrough(), so an unknown defaultView would silently
  // parse). Pin the ungated channel flag instead; defaultView is covered by
  // static evidence in the upgrade notes.
  const schema = SettingsSchema()

  test('accepts a boolean channelsEnabled', () => {
    expect(schema.safeParse({ channelsEnabled: true }).success).toBe(true)
    expect(schema.safeParse({ channelsEnabled: false }).success).toBe(true)
  })

  test('rejects a non-boolean channelsEnabled', () => {
    expect(schema.safeParse({ channelsEnabled: 'yes' }).success).toBe(false)
  })
})
