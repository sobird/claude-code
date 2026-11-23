import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

import { getEmptyToolPermissionContext } from '../../../Tool.js'
import type { ToolPermissionContext } from '../../../Tool.js'
import { reconcileAdditionalDirectories } from '../applySettingsChange.js'

function contextWith(
  dirs: Array<{ path: string; source: 'localSettings' | 'cliArg' | 'session' }>,
): ToolPermissionContext {
  return {
    ...getEmptyToolPermissionContext(),
    additionalWorkingDirectories: new Map(dirs.map((d) => [d.path, { path: d.path, source: d.source }])),
  }
}

const paths = (context: ToolPermissionContext): string[] => [...context.additionalWorkingDirectories.keys()]

describe('reconcileAdditionalDirectories', () => {
  test('a directory removed from settings loses access immediately', () => {
    const removed = resolve('/tmp/upgrade-dir-removed')
    const context = contextWith([{ path: removed, source: 'localSettings' }])
    const result = reconcileAdditionalDirectories(context, [removed], [])
    expect(paths(result)).not.toContain(removed)
  })

  test('a directory added in settings applies without a restart', () => {
    const added = resolve('/tmp/upgrade-dir-added')
    const context = getEmptyToolPermissionContext()
    const result = reconcileAdditionalDirectories(context, [], [added])
    expect(paths(result)).toContain(added)
  })

  test('removing a settings entry does not revoke an --add-dir directory', () => {
    const shared = resolve('/tmp/upgrade-dir-shared')
    const context = contextWith([{ path: shared, source: 'cliArg' }])
    const result = reconcileAdditionalDirectories(context, [shared], [])
    expect(paths(result)).toContain(shared)
  })

  test('normalizes ~ and relative settings entries before comparing', () => {
    const absolute = resolve('/tmp/upgrade-dir-tilde')
    const context = contextWith([{ path: absolute, source: 'localSettings' }])
    const unchanged = reconcileAdditionalDirectories(context, [absolute], [absolute])
    expect(paths(unchanged)).toEqual([absolute])
  })

  test('no changes leave the same context object', () => {
    const context = getEmptyToolPermissionContext()
    expect(reconcileAdditionalDirectories(context, [], [])).toBe(context)
  })
})
