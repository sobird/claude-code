import { readFile } from 'node:fs/promises'

import { SourceMapConsumer } from 'source-map'
import ts from 'typescript'

import { fingerprintFunction } from './fingerprint'
import type { AlignNode, AlignResult } from './types'

type AlignOptions = {
  referencePath: string
  mapPath?: string
  targetPath: string
  priorAlignPath?: string
}

type FnNode = {
  fingerprint: string
  kind: string
  name?: string
  start: number
  end: number
  line: number
  column: number
}

type Pair = {
  target: FnNode
  reference?: FnNode
  kind: 'matched' | 'changed' | 'new'
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  )
}

function functionName(node: ts.Node): string | undefined {
  const name = (node as ts.NamedDeclaration).name
  return name && ts.isIdentifier(name) ? name.text : undefined
}

// ScriptKind.JS forces JavaScript parsing, which is the source-file-level
// equivalent of the compiler `allowJs` flag. Parent nodes stay unset so the
// full parse trees can be collected for GC once functions have been extracted.
function collectFunctions(sourceFile: ts.SourceFile): FnNode[] {
  const out: FnNode[] = []
  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node)) {
      const start = node.getStart(sourceFile)
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(start)
      out.push({
        fingerprint: fingerprintFunction(node),
        kind: ts.SyntaxKind[node.kind],
        name: functionName(node),
        start,
        end: node.getEnd(),
        line: line + 1,
        column: character,
      })
    }
    node.forEachChild(visit)
  }
  visit(sourceFile)
  return out
}

async function parseFunctions(filePath: string): Promise<FnNode[]> {
  const source = await readFile(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    { languageVersion: ts.ScriptTarget.Latest },
    false,
    ts.ScriptKind.JS,
  )
  return collectFunctions(sourceFile)
}

// Pair target functions with reference functions. Identical fingerprints are
// `matched`; leftover nodes of the same syntax kind are `changed`; target-only
// nodes are `new`. Target order is preserved by the caller via a final sort.
function pairFunctions(reference: FnNode[], target: FnNode[]): Pair[] {
  const byFingerprint = new Map<string, FnNode[]>()
  for (const fn of reference) {
    const bucket = byFingerprint.get(fn.fingerprint) ?? []
    bucket.push(fn)
    byFingerprint.set(fn.fingerprint, bucket)
  }

  const used = new Set<FnNode>()
  const pairs: Pair[] = []
  const pending: FnNode[] = []

  for (const fn of target) {
    const bucket = byFingerprint.get(fn.fingerprint)
    if (bucket && bucket.length > 0) {
      const match = bucket.shift()!
      used.add(match)
      pairs.push({ target: fn, reference: match, kind: 'matched' })
    } else {
      pending.push(fn)
    }
  }

  const remaining = reference.filter((fn) => !used.has(fn))
  for (const fn of pending) {
    const index = remaining.findIndex((candidate) => candidate.kind === fn.kind)
    if (index >= 0) {
      const [match] = remaining.splice(index, 1)
      pairs.push({ target: fn, reference: match, kind: 'changed' })
    } else {
      pairs.push({ target: fn, kind: 'new' })
    }
  }

  return pairs
}

function toAlignNode(pair: Pair): AlignNode {
  const target: AlignNode['target'] = { start: pair.target.start, end: pair.target.end, kind: pair.target.kind }
  if (pair.target.name) target.name = pair.target.name
  const node: AlignNode = { target, confidence: 'high', classification: pair.kind }
  if (pair.reference) node.reference = { start: pair.reference.start, end: pair.reference.end }
  return node
}

async function attributeWithMap(pairs: Pair[], mapPath: string): Promise<AlignNode[]> {
  const rawMap = await readFile(mapPath, 'utf8')
  return SourceMapConsumer.with(rawMap, null, (consumer) => {
    return pairs.map((pair) => {
      const node = toAlignNode(pair)
      if (!pair.reference) return node

      const original = consumer.originalPositionFor({
        line: pair.reference.line,
        column: pair.reference.column,
      })
      if (!original.source || original.line === null) {
        node.confidence = 'medium'
        return node
      }

      node.source = { file: original.source, line: original.line }
      if (original.name) node.source.name = original.name
      if (original.source.includes('node_modules')) node.classification = 'ignored-dependency'
      return node
    })
  })
}

// Recover a fingerprint -> source map from a prior alignment so a bundle
// without its own source map can still inherit attribution. The prior target
// bundle is re-parsed to translate each prior node's start offset into a
// fingerprint.
async function loadPriorSources(priorAlignPath: string): Promise<Map<string, AlignNode['source']>> {
  const sources = new Map<string, AlignNode['source']>()
  try {
    const prior = JSON.parse(await readFile(priorAlignPath, 'utf8')) as AlignResult
    const priorFunctions = await parseFunctions(prior.source.target)
    const fingerprintByStart = new Map<number, string>()
    for (const fn of priorFunctions) fingerprintByStart.set(fn.start, fn.fingerprint)
    for (const node of prior.nodes) {
      if (!node.source) continue
      const fingerprint = fingerprintByStart.get(node.target.start)
      if (fingerprint) sources.set(fingerprint, node.source)
    }
  } catch {
    // Prior alignment is advisory: a missing or unreadable file yields no inheritance.
  }
  return sources
}

async function attributeWithoutMap(pairs: Pair[], priorAlignPath?: string): Promise<AlignNode[]> {
  const inherited = priorAlignPath ? await loadPriorSources(priorAlignPath) : new Map<string, AlignNode['source']>()
  return pairs.map((pair) => {
    const node = toAlignNode(pair)
    // Target-only nodes are `new` by definition: they have no reference
    // counterpart to inherit attribution from, so they stay unattributed.
    if (!pair.reference) {
      node.classification = 'new'
      node.confidence = 'low'
      return node
    }

    const source = inherited.get(pair.target.fingerprint)
    if (source) {
      node.source = source
      node.classification = pair.kind
      node.confidence = 'medium'
    } else {
      node.classification = 'unattributed'
      node.confidence = 'low'
    }
    return node
  })
}

export async function alignBundles(opts: AlignOptions): Promise<AlignResult> {
  const reference = await parseFunctions(opts.referencePath)
  const target = await parseFunctions(opts.targetPath)
  const pairs = pairFunctions(reference, target)

  const nodes = opts.mapPath
    ? await attributeWithMap(pairs, opts.mapPath)
    : await attributeWithoutMap(pairs, opts.priorAlignPath)

  nodes.sort((a, b) => a.target.start - b.target.start)

  return {
    source: { reference: opts.referencePath, target: opts.targetPath, map: Boolean(opts.mapPath) },
    nodes,
  }
}
