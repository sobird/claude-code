/**
 * Render-level E2E for the 2.1.90 UI surfaces: the /powerup hint in /help and
 * the /powerup lesson list. The logic tests in src/commands/powerup cover data
 * shaping; these drive the real Ink tree so layout gating (rows >= 44) and the
 * first rendered page are pinned too.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import React from 'react'
import stripAnsi from 'strip-ansi'

import { Powerups } from '../src/commands/powerup/powerup.js'
import { General } from '../src/components/HelpV2/General.js'
import { AppStateProvider } from '../src/state/AppState.js'
import { cleanup, renderForTest } from './ink-harness.js'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'help-powerup-render-'))
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

beforeEach(() => {
  // Isolate global config: Powerups seeds `unlocked` from ~/.claude.json.
  process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(tmpRoot, 'cfg-'))
})

afterEach(cleanup)

afterAll(() => {
  if (originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('/help powerup hint', () => {
  test('shows the /powerup nudge on a tall terminal', async () => {
    const app = await renderForTest(<General />, { rows: 50 })
    const rendered = stripAnsi(app.lastFrame())

    expect(rendered).toContain('New here? Run')
    expect(rendered).toContain('/powerup')
    expect(rendered).toContain('to learn the features most people miss')
    // The shortcut table still renders below the hint.
    expect(rendered).toContain('Shortcuts')
  })

  test('hides the nudge when rows are below the threshold', async () => {
    const app = await renderForTest(<General />, { rows: 24 })
    const rendered = stripAnsi(app.lastFrame())

    expect(rendered).not.toContain('New here?')
    expect(rendered).toContain('Shortcuts')
  })
})

describe('/powerup lesson list', () => {
  test('renders the first page with progress and lesson titles', async () => {
    const app = await renderForTest(
      <AppStateProvider>
        <Powerups onExit={() => {}} />
      </AppStateProvider>,
      { rows: 50 },
    )
    const rendered = stripAnsi(app.lastFrame())

    expect(rendered).toContain('Power-ups')
    expect(rendered).toContain('0/10 unlocked')
    expect(rendered).toContain('Talk to your codebase')
    expect(rendered).toContain('Dial the model')
  })
})
