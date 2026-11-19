import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import * as React from 'react'

import { FORK_GLYPH } from '../../constants/figures.js'
import { FORK_BOILERPLATE_TAG, FORK_DIRECTIVE_PREFIX } from '../../constants/xml.js'
import { Box, Text } from '../../ink.js'
import { truncateToWidth } from '../../utils/format.js'

type Props = {
  addMargin: boolean
  param: TextBlockParam
}

const TRUNCATE_AT = 80
const BOILERPLATE_RE = new RegExp(`<${FORK_BOILERPLATE_TAG}>[\\s\\S]*?</${FORK_BOILERPLATE_TAG}>`)

/**
 * A fork child's first prompt is the parent conversation plus a long
 * rules/format boilerplate block followed by `Your directive: <scope>`.
 * Collapse the boilerplate and surface only the directive.
 */
export function UserForkBoilerplateMessage({ addMargin, param: { text } }: Props): React.ReactNode {
  const directive = text.replace(BOILERPLATE_RE, '').trim()
  const body = directive.startsWith(FORK_DIRECTIVE_PREFIX)
    ? directive.slice(FORK_DIRECTIVE_PREFIX.length).trim()
    : directive
  if (body.length === 0) return null
  return (
    <Box marginTop={addMargin ? 1 : 0}>
      <Text>
        <Text color="suggestion">{FORK_GLYPH}</Text> <Text dimColor>Fork directive:</Text>{' '}
        {truncateToWidth(body, TRUNCATE_AT)}
      </Text>
    </Box>
  )
}
