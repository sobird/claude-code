import { readFile } from 'node:fs/promises'

import { SourceMapConsumer } from 'source-map'
import ts from 'typescript'

import { functionSignature } from './fingerprint'
import type { AlignNode, AlignResult } from './types'

type AlignOptions = {
  referencePath: string
  mapPath?: string
  targetPath: string
  priorAlignPath?: string
}

type FnNode = {
  fingerprint: string
  literals: string[]
  kind: string
  name?: string
  start: number
  end: number
  line: number
  column: number
  // Position among all functions of the parsed file, used as the pairing
  // tie-breaker when two candidates share the same literal overlap.
  index: number
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
      const signature = functionSignature(node)
      out.push({
        fingerprint: signature.fingerprint,
        literals: signature.literals,
        kind: ts.SyntaxKind[node.kind],
        name: functionName(node),
        start,
        end: node.getEnd(),
        line: line + 1,
        column: character,
        index: out.length,
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

function jaccard(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0
  const rightSet = new Set(right)
  let shared = 0
  for (const value of left) if (rightSet.has(value)) shared++
  return shared / (left.length + right.length - shared)
}

// String-literal overlap says what a function still talks about after an edit;
// relative file position breaks ties when the overlap is equal (or empty).
function pairScore(target: FnNode, reference: FnNode, targetCount: number, referenceCount: number): number {
  const targetPos = targetCount > 1 ? target.index / (targetCount - 1) : 0
  const referencePos = referenceCount > 1 ? reference.index / (referenceCount - 1) : 0
  return jaccard(target.literals, reference.literals) + 0.25 * (1 - Math.abs(targetPos - referencePos))
}

// Pair target functions with reference functions. Identical fingerprints are
// `matched`; leftover nodes of the same syntax kind are `changed`, choosing the
// best-scoring candidate rather than the first same-kind leftover; target-only
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
    let bestIndex = -1
    let bestScore = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]
      if (candidate.kind !== fn.kind) continue
      const score = pairScore(fn, candidate, target.length, reference.length)
      if (score > bestScore) {
        bestScore = score
        bestIndex = i
      }
    }
    if (bestIndex >= 0) {
      const [match] = remaining.splice(bestIndex, 1)
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
