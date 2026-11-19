import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import ts from 'typescript'

const COMMAND_TYPES = new Set(['local', 'local-jsx', 'prompt'])

function unwrap(node: ts.Node): ts.Node {
  while (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    node = node.expression
  }
  return node
}

// Commands are object literals with literal `type` and `name` properties.
// Reading them through the TS parser tolerates `as const`, property reordering
// and formatting, which a regex over minified text cannot — and avoids matching
// unrelated `name:` properties (tools, agents, MCP servers) that a broad regex
// would treat as commands.
export function commandNamesInSourceFile(filePath: string, text: string): string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    { languageVersion: ts.ScriptTarget.Latest },
    false,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const names: string[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      let type: string | undefined
      let name: string | undefined
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue
        const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined
        const value = unwrap(property.initializer)
        if (key === 'type' && ts.isStringLiteral(value)) type = value.text
        if (key === 'name' && ts.isStringLiteral(value)) name = value.text
      }
      if (type && name && COMMAND_TYPES.has(type)) names.push(name)
    }
    node.forEachChild(visit)
  }

  visit(sourceFile)
  return names
}

export async function extractSrcCommandNames(dir: string): Promise<string[]> {
  const names = new Set<string>()

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        for (const name of commandNamesInSourceFile(full, await readFile(full, 'utf8'))) names.add(name)
      }
    }
  }

  await walk(dir)
  return [...names].toSorted()
}
