import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseInspectorUrl, runProbe } from '../probe'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), `probe-${process.pid}-`))
  tempDirs.push(dir)
  return dir
}

function writeTemp(name: string, contents: string): string {
  const path = join(tempDir(), name)
  writeFileSync(path, contents)
  return path
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test('parses inspector url', () => {
  expect(parseInspectorUrl('Debugger listening on ws://127.0.0.1:9229/uuid')).toBe('ws://127.0.0.1:9229/uuid')
  expect(parseInspectorUrl('no url here')).toBeNull()
})

test('runs a scenario without breakpoints to completion', async () => {
  const target = writeTemp('noop.js', "process.stdout.write('ok\\n')\n")
  const scenario = writeTemp('noop-scenario.json', JSON.stringify({ args: [], breakpoints: [], capture: [] }))

  const trace = await runProbe({ targetPath: target, scenarioPath: scenario, timeoutMs: 10_000 })

  expect(trace.label).toBe('noop-scenario')
  expect(trace.frames).toEqual([])
  expect(trace.captured).toEqual([])
})

test('captures args and fn.toString at a breakpoint', async () => {
  const target = writeTemp(
    'greet.js',
    ['function greet(name) {', "  const message = 'hello ' + name", '  return message', '}', "greet('world')", ''].join(
      '\n',
    ),
  )
  const scenario = writeTemp(
    'greet-scenario.json',
    JSON.stringify({
      args: [],
      breakpoints: [{ script: 'greet.js', line: 2, column: 0, label: 'greet' }],
      capture: ['args', 'fn.toString'],
    }),
  )

  const trace = await runProbe({ targetPath: target, scenarioPath: scenario, timeoutMs: 10_000 })

  expect(trace.label).toBe('greet-scenario')
  expect(trace.frames[0]).toMatchObject({ fn: 'greet', line: 2 })
  expect(typeof trace.frames[0].column).toBe('number')
  expect(trace.captured).toHaveLength(1)
  expect(trace.captured[0].label).toBe('greet')
  expect(trace.captured[0].args).toEqual(['world'])
  expect(String(trace.captured[0]['fn.toString'])).toContain('function greet')
})
