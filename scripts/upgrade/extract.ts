import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import ts from 'typescript'

import type { AlignResult } from './types'

type ExtractOptions = {
  alignPath: string
  targetPath: string
  outDir: string
  keywords: string[]
}

function sanitizeKind(kind: string): string {
  return kind
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// The sliced bundle snippet is standalone, so parse it on its own and let the
// TypeScript printer re-emit it with consistent formatting.
function formatSnippet(snippet: string): string {
  const sourceFile = ts.createSourceFile(
    'candidate.ts',
    snippet,
    { languageVersion: ts.ScriptTarget.Latest },
    false,
    ts.ScriptKind.TS,
  )
  return ts.createPrinter().printNode(ts.EmitHint.Unspecified, sourceFile, sourceFile)
}

export async function extractCandidates(opts: ExtractOptions): Promise<string[]> {
  const align = JSON.parse(await readFile(opts.alignPath, 'utf8')) as AlignResult
  const target = await readFile(opts.targetPath, 'utf8')
  const keywords = opts.keywords.map((keyword) => keyword.toLowerCase())
  const candidateDir = join(opts.outDir, 'candidates')
  await mkdir(candidateDir, { recursive: true })

  const written: string[] = []

  for (let index = 0; index < align.nodes.length; index++) {
    const node = align.nodes[index]
    // Only changed/new nodes are candidates. This also excludes dependency
    // nodes (`ignored-dependency`, which map attribution can assign to an
    // otherwise-changed pair), matched nodes, and unattributed nodes, even when
    // a keyword happens to appear in their bundled body.
    if (node.classification !== 'changed' && node.classification !== 'new') continue

    const snippet = target.slice(node.target.start, node.target.end)
    const haystack = snippet.toLowerCase()
    if (keywords.length === 0 || !keywords.some((keyword) => haystack.includes(keyword))) continue

    const filename = `${index}-${sanitizeKind(node.target.kind)}.ts`
    const filePath = join(candidateDir, filename)
    await writeFile(filePath, formatSnippet(snippet))
    written.push(filePath)
  }

  return written
}
