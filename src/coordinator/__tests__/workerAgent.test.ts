import { describe, expect, test } from 'bun:test'

import { FILE_READ_TOOL_NAME } from '../../tools/FileReadTool/prompt.js'
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '../../tools/SyntheticOutputTool/SyntheticOutputTool.js'
import { getCoordinatorAgents } from '../workerAgent.js'

describe('getCoordinatorAgents', () => {
  test('returns one built-in worker agent with the async-agent tool pool', () => {
    const agents = getCoordinatorAgents()
    expect(agents).toHaveLength(1)

    const worker = agents[0]
    expect(worker?.agentType).toBe('worker')
    expect(worker?.source).toBe('built-in')
    expect(worker?.tools).toContain(FILE_READ_TOOL_NAME)
    // SyntheticOutput is coordinator-internal — workers must not receive it.
    expect(worker?.tools).not.toContain(SYNTHETIC_OUTPUT_TOOL_NAME)
  })
})
