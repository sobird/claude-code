import {
  ListResourcesResultSchema,
  type ReadResourceResult,
  ReadResourceResultSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { normalizeNameForMCP } from '../services/mcp/normalization.js'
import type { MCPServerConnection } from '../services/mcp/types.js'
import type { Command } from '../types/command.js'
import { errorMessage } from '../utils/errors.js'
import { parseFrontmatter } from '../utils/frontmatterParser.js'
import { logMCPDebug, logMCPError } from '../utils/log.js'
import { memoizeWithLRU } from '../utils/memoize.js'
import { getMCPSkillBuilders } from './mcpSkillBuilders.js'

const SKILL_URI_PREFIX = 'skill://'

// Matches MCP_FETCH_CACHE_SIZE in services/mcp/client.ts — the same handful of
// servers is cached across tools/commands/resources/skills.
const MCP_SKILLS_CACHE_SIZE = 20

/**
 * Derives a skill's identifier from its `skill://` resource URI.
 *
 * Accepts both the short form (`skill://pdf`) and a directory form
 * (`skill://skills/pdf/SKILL.md`), returning the final path segment. Returns
 * null for non-skill URIs or URIs with no name segment.
 */
function skillNameFromUri(uri: string): string | null {
  if (!uri.startsWith(SKILL_URI_PREFIX)) return null
  const path = uri
    .slice(SKILL_URI_PREFIX.length)
    .replace(/[/\\]+SKILL\.md$/i, '')
    .replace(/^[/\\]+|[/\\]+$/g, '')
  if (!path) return null
  const segments = path.split(/[/\\]/)
  const name = segments[segments.length - 1]
  return name || null
}

/**
 * Discovers skills exposed by an MCP server as `skill://` resources.
 *
 * Each skill resource body is a SKILL.md-style markdown document (optional
 * frontmatter + prompt body). The body is read once at discovery time and
 * baked into the resulting {@link Command}, which is why results are memoized
 * by server name — callers invalidate via `fetchMcpSkillsForClient.cache.delete`.
 *
 * Command names are `<normalized-server>:<skill>` (not `mcp__<server>__…`, which
 * is the prompt/tool convention) so {@link commandBelongsToServer} and the
 * skills menu can attribute them to their server.
 */
export const fetchMcpSkillsForClient = memoizeWithLRU(
  async (client: MCPServerConnection): Promise<Command[]> => {
    if (client.type !== 'connected') return []
    if (!client.capabilities?.resources) return []

    try {
      const list = await client.client.request({ method: 'resources/list' }, ListResourcesResultSchema)
      const skillResources = (list.resources ?? []).filter((resource) => resource.uri.startsWith(SKILL_URI_PREFIX))
      if (skillResources.length === 0) return []

      const { createSkillCommand, parseSkillFrontmatterFields } = getMCPSkillBuilders()
      const serverPrefix = normalizeNameForMCP(client.name)

      const commands = await Promise.all(
        skillResources.map(async (resource): Promise<Command | null> => {
          const resourceName = skillNameFromUri(resource.uri)
          if (!resourceName) return null

          try {
            const read = (await client.client.request(
              {
                method: 'resources/read',
                params: { uri: resource.uri },
              },
              ReadResourceResultSchema,
            )) as ReadResourceResult

            // Skills are text markdown; blob-only resources are not skills.
            const textContent = read.contents.find((c) => 'text' in c)
            if (!textContent || typeof textContent.text !== 'string') return null

            const { frontmatter, content } = parseFrontmatter(textContent.text, resource.uri)
            const skillName = `${serverPrefix}:${resourceName}`
            const parsed = parseSkillFrontmatterFields(frontmatter, content, skillName)

            return createSkillCommand({
              ...parsed,
              skillName,
              markdownContent: content,
              source: 'mcp',
              baseDir: undefined,
              loadedFrom: 'mcp',
              paths: undefined,
            })
          } catch (error) {
            logMCPError(client.name, `Failed to load skill '${resource.uri}': ${errorMessage(error)}`)
            return null
          }
        }),
      )

      const skills = commands.filter((c): c is Command => c !== null)
      if (skills.length > 0) {
        logMCPDebug(client.name, `Discovered ${skills.length} skill(s) from skill:// resources`)
      }
      return skills
    } catch (error) {
      logMCPError(client.name, `Failed to fetch skills: ${errorMessage(error)}`)
      return []
    }
  },
  (client: MCPServerConnection) => client.name,
  MCP_SKILLS_CACHE_SIZE,
)
