/**
 * End-to-end coverage of the search and write tools. Glob, Grep, Write and
 * NotebookEdit each run against a real working directory, and their results
 * are fed back into the scripted model conversation — so this pins both the
 * tool execution and the tool_result round trip.
 */

import { afterEach, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { startFakeAnthropic, textReply, toolUseReply, type FakeAnthropic, type FakeScript } from './fake-anthropic'
import { cleanupRoots, isolatedEnv, lastJsonLine, makeTempRoot, runCli, type TempRoot } from './harness'

const TEST_TIMEOUT = 120_000

const fakes: FakeAnthropic[] = []
const roots: string[] = []

async function fake(script: FakeScript): Promise<FakeAnthropic> {
  const server = await startFakeAnthropic(script)
  fakes.push(server)
  return server
}

function project(): TempRoot {
  const root = makeTempRoot()
  roots.push(root.root)
  return root
}

function run(root: TempRoot, server: FakeAnthropic, args: string[]) {
  return runCli({
    cwd: root.work,
    env: isolatedEnv({ home: root.home, config: root.config, baseUrl: server.url }),
    args,
  })
}

afterEach(() => {
  for (const server of fakes.splice(0)) server.stop()
  cleanupRoots(roots)
})

test(
  'executes Glob, Grep and Write and feeds results back to the model',
  async () => {
    const root = project()
    writeFileSync(join(root.work, 'alpha.md'), 'alpha needle line\n')
    writeFileSync(join(root.work, 'beta.md'), 'beta line\n')
    const server = await fake([
      toolUseReply([{ name: 'Glob', input: { pattern: '*.md' } }]),
      toolUseReply([{ name: 'Grep', input: { pattern: 'needle', output_mode: 'content' } }]),
      toolUseReply([{ name: 'Write', input: { file_path: join(root.work, 'out.txt'), content: 'WRITTEN\n' } }]),
      textReply('TOOLS_OK'),
    ])

    const result = await run(root, server, [
      '-p',
      'search then write',
      '--allowedTools',
      'Glob',
      'Grep',
      'Write',
      '--output-format',
      'json',
    ])
    expect(result.exitCode).toBe(0)
    expect(lastJsonLine(result.stdout).result).toBe('TOOLS_OK')
    expect(server.requests.length).toBe(4)

    // Glob's tool_result comes back in the next request.
    const afterGlob = JSON.stringify(server.requests[1]?.body)
    expect(afterGlob).toContain('alpha.md')
    expect(afterGlob).toContain('beta.md')

    // Grep in content mode returns the matching line.
    expect(JSON.stringify(server.requests[2]?.body)).toContain('needle')

    expect(readFileSync(join(root.work, 'out.txt'), 'utf8')).toBe('WRITTEN\n')
  },
  TEST_TIMEOUT,
)

test(
  'replaces a notebook cell with NotebookEdit',
  async () => {
    const root = project()
    const notebook = join(root.work, 'notebook.ipynb')
    writeFileSync(
      notebook,
      JSON.stringify({
        cells: [
          {
            cell_type: 'code',
            id: 'cell-1',
            metadata: {},
            outputs: [],
            execution_count: null,
            source: ['print(1)'],
          },
        ],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      }),
    )
    // NotebookEdit requires a prior read of the file (same guard as Edit/Write).
    const server = await fake([
      toolUseReply([{ name: 'Read', input: { file_path: notebook } }]),
      toolUseReply([
        { name: 'NotebookEdit', input: { notebook_path: notebook, cell_id: 'cell-1', new_source: 'print(2)' } },
      ]),
      textReply('NOTEBOOK_OK'),
    ])

    const result = await run(root, server, [
      '-p',
      'edit the notebook',
      '--allowedTools',
      'Read',
      'NotebookEdit',
      '--output-format',
      'json',
    ])
    expect(result.exitCode).toBe(0)
    expect(lastJsonLine(result.stdout).result).toBe('NOTEBOOK_OK')
    expect(readFileSync(notebook, 'utf8')).toContain('print(2)')
  },
  TEST_TIMEOUT,
)
