import { expect, test } from 'bun:test'

import { FILE_UNEXPECTEDLY_MODIFIED_ERROR } from '../src/tools/FileEditTool/constants.js'

test('stale-edit message points at a linter or formatter run via Bash', () => {
  expect(FILE_UNEXPECTEDLY_MODIFIED_ERROR).toBe(
    'File content has changed since it was last read. This commonly happens when a linter or formatter run via Bash rewrites the file. Call Read on this file to refresh, then retry the edit.',
  )
})
