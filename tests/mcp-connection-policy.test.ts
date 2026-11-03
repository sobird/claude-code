import { expect, test } from 'bun:test'

import {
  isMcpConnectionNonblocking,
  MCP_CONNECT_TIMEOUT_MS,
  shouldBlockOnMcpConnect,
  waitForMcpConnect,
} from '../src/services/mcp/connectionPolicy.js'

test('env truthiness drives the policy', () => {
  expect(isMcpConnectionNonblocking({ MCP_CONNECTION_NONBLOCKING: '1' })).toBe(true)
  expect(isMcpConnectionNonblocking({ MCP_CONNECTION_NONBLOCKING: 'true' })).toBe(true)
  expect(isMcpConnectionNonblocking({ MCP_CONNECTION_NONBLOCKING: '0' })).toBe(false)
  expect(isMcpConnectionNonblocking({})).toBe(false)
  expect(shouldBlockOnMcpConnect({ env: { MCP_CONNECTION_NONBLOCKING: '1' } })).toBe(false)
  expect(shouldBlockOnMcpConnect({ env: {} })).toBe(true)
  expect(MCP_CONNECT_TIMEOUT_MS).toBe(5000)
})

test('nonblocking env does not await the connection', async () => {
  const started = performance.now()
  await waitForMcpConnect(new Promise<void>(() => {}), 'servers', {
    env: { MCP_CONNECTION_NONBLOCKING: '1' },
    timeoutMs: 60_000,
  })
  expect(performance.now() - started).toBeLessThan(1000)
})

test('resolved connections return before the timeout', async () => {
  await waitForMcpConnect(Promise.resolve(), 'servers', { env: {}, timeoutMs: 5000 })
})

test('unresolved connections proceed after the timeout', async () => {
  const started = performance.now()
  await waitForMcpConnect(new Promise<void>(() => {}), 'servers', { env: {}, timeoutMs: 20 })
  expect(performance.now() - started).toBeGreaterThanOrEqual(15)
})
