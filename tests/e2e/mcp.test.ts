/**
 * End-to-end coverage of MCP wiring: a real stdio server launched from
 * --mcp-config, its tools discovered before the first model call, and a
 * model-issued call executed through the MCP client.
 */

import { afterEach, expect, test } from 'bun:test'
import { join } from 'node:path'

import { startFakeAnthropic, textReply, toolUseReply, type FakeAnthropic } from './fake-anthropic'
import { cleanupRoots, isolatedEnv, lastJsonLine, makeTempRoot, runCli, type TempRoot } from './harness'

const TEST_TIMEOUT = 120_000

const FIXTURE = join(import.meta.dir, 'mcp-echo-server.ts')

const fakes: FakeAnthropic[] = []
const roots: string[] = []

function project(): TempRoot {
  const root = makeTempRoot()
  roots.push(root.root)
  return root
}

afterEach(() => {
  for (const server of fakes.splice(0)) server.stop()
  cleanupRoots(roots)
})

test(
  'discovers and calls a tool from a stdio MCP server',
  async () => {
    const root = project()
    const mcpConfig = JSON.stringify({
      mcpServers: { fixture: { type: 'stdio', command: 'bun', args: [FIXTURE] } },
    })
    const server = await startFakeAnthropic([
      toolUseReply([{ name: 'mcp__fixture__echo', input: { text: 'PING' } }]),
      textReply('MCP_OK'),
    ])
    fakes.push(server)

    const result = await runCli({
      cwd: root.work,
      env: isolatedEnv({ home: root.home, config: root.config, baseUrl: server.url }),
      args: [
        '-p',
        'call the mcp tool',
        '--mcp-config',
        mcpConfig,
        '--strict-mcp-config',
        '--allowedTools',
        'mcp__fixture',
        '--output-format',
        'json',
      ],
    })
    expect(result.exitCode).toBe(0)
    expect(lastJsonLine(result.stdout).result).toBe('MCP_OK')

    // Turn 1 must already advertise the server's tool.
    const firstTools = (server.requests[0]?.body?.tools ?? []) as Array<{ name: string }>
    expect(firstTools.map((tool) => tool.name)).toContain('mcp__fixture__echo')

    // Turn 2 carries the MCP tool result back to the model.
    expect(JSON.stringify(server.requests[1]?.body)).toContain('ECHO:PING')
  },
  TEST_TIMEOUT,
)
