/**
 * Headless render harness for the vendored Ink fork (`src/ink`).
 *
 * Why not `ink-testing-library`: that package drives the npm `ink`, not this
 * fork. The fork's own test hooks are:
 *
 *   - `src/ink/reconciler.ts`  NODE_ENV === 'test' -> rootNode.onImmediateRender()
 *     (renders synchronously, bypassing the frame throttle)
 *   - `src/ink/ink.tsx`        onImmediateRender is wired to onRender
 *   - `src/ink/components/App.tsx`  raw mode + input require stdin.isTTY === true
 *
 * This harness wires those together: a non-TTY PassThrough stdout (so each
 * frame is emitted whole), a TTY-shaped fake stdin (so `useInput` works), and
 * `lastFrame()` for assertions.
 *
 * Notably it does NOT treat every stdout `write()` as a frame the way
 * ink-testing-library does: once `useInput` is mounted the fork also writes
 * terminal control/query sequences (bracketed paste, focus reporting,
 * XTVERSION/DA1 probes) to stdout, so the last raw write is often `\x1b[c` and
 * not the rendered content. Frames are peeled out of the DEC-2026 sync markers
 * instead.
 *
 * Usage:
 *   const app = await renderForTest(<Counter />)
 *   expect(stripAnsi(app.lastFrame())).toContain('count: 0')
 *   app.write(' ')                 // simulate a keystroke
 *   await app.tick()               // let React commit
 *   expect(stripAnsi(app.lastFrame())).toContain('count: 1')
 *   app.unmount()
 *
 * In a test file, prefer the module-level cleanup so nothing leaks between
 * cases:
 *   import { cleanup, renderForTest } from './ink-harness.js'
 *   afterEach(cleanup)
 */

import { PassThrough, Readable } from 'node:stream'

import React, { type ReactNode } from 'react'
import { render, ThemeProvider, type Instance } from 'src/ink.js'
import type { FrameEvent } from 'src/ink/frame.js'
// BSU/ESU = Begin/End Synchronized Update — the DEC-2026 markers Ink wraps
// around each frame. Absent on plain pipes, hence lastFrame()'s raw fallback.
import { BSU, ESU } from 'src/ink/termio/dec.js'

export type Harness = {
  /** Content of the most recent frame (raw ANSI). Feed to stripAnsi() to assert. */
  lastFrame: () => string
  /** Every complete frame captured so far, oldest first. */
  frames: string[]
  /** Per-frame timing/phases/flickers, straight from RenderOptions.onFrame. */
  frameEvents: FrameEvent[]
  /** Bytes written to stdout that are NOT part of a complete frame — the
   *  terminal control/query sequences around the frames. Raw ANSI. */
  raw: () => string
  /** Last chunk written to stderr (raw). */
  lastStderrFrame: () => string
  /** Everything written to stderr, concatenated (raw). */
  stderr: () => string
  /** Simulate keystrokes / pasted text on stdin. */
  write: (input: string) => void
  /** Swap the rendered tree in place (no remount). */
  rerender: (node: ReactNode) => void
  /** Await a microtask + timer flush so a post-input re-render is committed. */
  tick: () => Promise<void>
  /** Unmount this instance and stop tracking it. */
  unmount: () => void
  instance: Instance
}

// Every live instance, so cleanup() can tear them all down (afterEach(cleanup)).
const instances = new Set<Instance>()

/** Unmount every instance still tracked. Safe to call repeatedly. */
export function cleanup(): void {
  for (const instance of instances) {
    try {
      instance.unmount()
    } catch {
      // Already unmounted — nothing to do.
    }
  }
  instances.clear()
}

/**
 * Fake stdin. `Readable` rather than `PassThrough`: Ink only ever reads from
 * stdin, so the writable half a PassThrough would add is dead weight. Input is
 * fed in via `push()` (exposed as the harness's `write()`).
 *
 * `isTTY: true` is what App.isRawModeSupported() checks (components/App.tsx);
 * the raw-mode / ref methods are stubs the fork calls but a test doesn't need.
 */
class FakeStdin extends Readable {
  isTTY = true
  isRaw = false

  // Readable has no data source of its own; data arrives via push().
  override _read(): void {}

  setRawMode(_mode: boolean): void {}

  ref(): this {
    return this
  }

  unref(): this {
    return this
  }
}

/**
 * Fake stdout. `PassThrough` because Ink both writes frames into it and the
 * harness reads them back out (`Readable` alone would be write-only here).
 *
 * `isTTY: false` makes Ink emit whole frames instead of cursor diffs; `columns`
 * is what Ink reads for layout width (ink.tsx:238, else it falls back to 80).
 *
 * Ink's `render` types this as `NodeJS.WriteStream` (= `tty.WriteStream`, a
 * net.Socket subclass), so the call site still narrows with a cast. This class
 * only makes the extra fields honest — it can't make the types overlap.
 */
class FakeStdout extends PassThrough {
  isTTY = false
  columns: number

  constructor(columns: number) {
    super()
    this.columns = columns
  }
}

/** Fake stderr. Same idea as FakeStdout, minus the layout width Ink never reads. */
class FakeStderr extends PassThrough {
  isTTY = false
}

/**
 * Peels complete DEC-2026-wrapped frames out of a stream's output, holding back
 * the trailing partial bytes so a frame split across `write()`s is still
 * captured whole.
 *
 * Deliberately NOT a method on the stream: frame parsing is a test concern, not
 * a property of stdout (the real `process.stdout` has no `.frames`). Same split
 * as `src/utils/staticRender.tsx`, which pairs a plain PassThrough with a
 * standalone `extractFirstFrame`.
 */
class FrameReader {
  /** Complete frames, oldest first. */
  readonly frames: string[] = []
  private rest = ''

  constructor(stream: Readable) {
    stream.on('data', (chunk: Buffer | string) => {
      this.rest += chunk.toString()
      for (;;) {
        const start = this.rest.indexOf(BSU)
        if (start === -1) break
        const end = this.rest.indexOf(ESU, start + BSU.length)
        if (end === -1) break
        this.frames.push(this.rest.slice(start + BSU.length, end))
        this.rest = this.rest.slice(end + ESU.length)
      }
    })
  }

  /** Most recent frame, or the unconsumed tail when no frame has completed. */
  lastFrame(): string {
    return this.frames.at(-1) ?? this.rest
  }

  /** Bytes written so far that are not part of a complete frame. */
  raw(): string {
    return this.rest
  }
}

export async function renderForTest(node: ReactNode, { columns = 100 }: { columns?: number } = {}): Promise<Harness> {
  // Drives reconciler.ts's synchronous onImmediateRender path.
  process.env.NODE_ENV = 'test'

  const stdout = new FakeStdout(columns) // non-TTY -> Ink emits whole frames, not diffs
  const stderr = new FakeStderr()
  const stdin = new FakeStdin()

  const reader = new FrameReader(stdout)
  const frameEvents: FrameEvent[] = []

  let stderrOutput = ''
  let lastStderr = ''
  stderr.on('data', (chunk: Buffer | string) => {
    lastStderr = chunk.toString()
    stderrOutput += lastStderr
  })

  const instance = await render(node, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    onFrame: (event) => frameEvents.push(event),
    patchConsole: false,
  })
  instances.add(instance)

  return {
    frames: reader.frames,
    frameEvents,
    lastFrame: () => reader.lastFrame(),
    raw: () => reader.raw(),
    lastStderrFrame: () => lastStderr,
    stderr: () => stderrOutput,
    write: (input: string) => {
      stdin.push(input)
    },
    rerender: (next: ReactNode) => {
      // `render` (src/ink.ts) wraps in ThemeProvider; instance.rerender does
      // not, so wrap here to keep themed components working across re-renders.
      instance.rerender(<ThemeProvider>{next}</ThemeProvider>)
    },
    tick: async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
    unmount: () => {
      instances.delete(instance)
      instance.unmount()
    },
    instance,
  }
}
