/**
 * Semantic localization of bundle changes that survive the minifier.
 *
 * `inventory`/`table`/`strings` need a new literal, flag, env or table to anchor
 * a change. A pure-logic fix (e.g. "scrollback repeated diff / blank pages")
 * adds no literal, so those tools see nothing. With no source map, this walks
 * the two minified bundles at the token level while normalizing every
 * non-keyword identifier to `I`. Minifier renames (which differ every release)
 * then compare equal, and only genuine logic edits surface as insert/delete
 * runs.
 *
 * Three scopes, cheapest first:
 *   - anchors  : O(n). Map unique string literals across both bundles and report
 *                where the target stream gains/removes text. No Myers, so it is
 *                safe over multi-megabyte bands.
 *   - segment  : diff the token stream between two stable anchor literals. This
 *                is the technique that proved `log-update.ts`'s `render()` was
 *                byte-identical `mod` renames across 2.1.92 -> 2.1.94.
 *   - around   : diff a fixed +/- pad window around one anchor. Fast to reach,
 *                but the window can land on different content across versions;
 *                prefer `segment` when two stable anchors exist.
 *
 * Myers runs with an edit budget (`maxEdits`). A large, mostly-different band is
 * bounded work instead of the O(N*M) blow-up that hangs on a huge insertion.
 */

import { readQuoted, readTemplate, skipRegex, startsRegex } from './stringScanner'

const KEYWORDS = new Set(
  (
    'break case catch class const continue debugger default delete do else export extends finally for ' +
    'function if import in instanceof new return super switch this throw try typeof var void while with ' +
    'yield let static get set of async await true false null undefined NaN Infinity'
  ).split(' '),
)

export type BundleToken = {
  /** Normalized form used for comparison: identifiers collapse to `I`. */
  norm: string
  /** Verbatim source slice. */
  raw: string
  /** Absolute offset into the original bundle (not the sliced window). */
  start: number
  end: number
  isIdentifier: boolean
}

export type DiffOp =
  | { op: 'eq'; aIndex: number; bIndex: number }
  | { op: 'ins'; bIndex: number }
  | { op: 'del'; aIndex: number }

export type BundleRun = {
  side: 'reference' | 'target'
  start: number
  end: number
  tokens: number
  text: string
}

export type DiffStats = {
  tokensReference: number
  tokensTarget: number
  eq: number
  ins: number
  del: number
  identical: boolean
}

export type SegmentScope = {
  mode: 'segment'
  startAnchor: string
  endAnchor: string
  range: { reference: [number, number]; target: [number, number] }
}

export type AroundScope = {
  mode: 'around'
  anchor: string
  pad: number
  /** Windows are located independently per bundle; they can be misaligned. */
  range: { reference: [number, number]; target: [number, number] }
}

export type AnchorsScope = {
  mode: 'anchors'
  band: [number, number]
  minLen: number
  minChg: number
  minExtra: number
}

export type DiffResult = {
  scope: SegmentScope | AroundScope
  stats: DiffStats
  truncated: boolean
  message?: string
  runs: BundleRun[]
}

export type DeltaChangePoint = { targetPos: number; referencePos: number; delta: number; chg: number }

export type BigInsertion = { targetStart: number; targetEnd: number; extra: string }

export type AnchorsResult = {
  scope: AnchorsScope
  anchorCount: number
  changePoints: DeltaChangePoint[]
  bigInsertions: BigInsertion[]
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Walk `source` (a slice of a bundle positioned at absolute `base` here for
 * segment scope, or `0` otherwise) and emit tokens. Comments and whitespace are
 * dropped; strings, templates and regexes are single verbatim tokens; every
 * other identifier (except JS keywords) becomes `I` so minifier renames vanish.
 */
export function tokenize(source: string, base = 0): BundleToken[] {
  const tokens: BundleToken[] = []
  const n = source.length
  let i = 0
  let prev = ''

  const push = (start: number, end: number, isIdentifier: boolean, norm: string): void => {
    tokens.push({ norm, raw: source.slice(start, end), start: base + start, end: base + end, isIdentifier })
  }

  while (i < n) {
    const ch = source[i]

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }

    if (ch === '/' && source[i + 1] === '/') {
      i += 2
      while (i < n && source[i] !== '\n') i++
      continue
    }

    if (ch === '/' && source[i + 1] === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++
      i += 2
      continue
    }

    if (ch === '"' || ch === "'") {
      const next = readQuoted(source, i, ch).next
      push(i, next, false, source.slice(i, next))
      i = next
      prev = ch
      continue
    }

    if (ch === '`') {
      const next = readTemplate(source, i).next
      push(i, next, false, source.slice(i, next))
      i = next
      prev = '`'
      continue
    }

    if (ch === '/' && startsRegex(source, i, prev)) {
      const next = skipRegex(source, i)
      push(i, next, false, source.slice(i, next))
      i = next
      prev = source[next - 1] ?? '/'
      continue
    }

    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1
      while (j < n && /[\w$]/.test(source[j])) j++
      const word = source.slice(i, j)
      push(i, j, true, KEYWORDS.has(word) ? word : 'I')
      i = j
      prev = word[word.length - 1] ?? ''
      continue
    }

    if (/[0-9]/.test(ch)) {
      let j = i + 1
      while (j < n && /[0-9.]/.test(source[j])) j++
      push(i, j, false, source.slice(i, j))
      i = j
      prev = '0'
      continue
    }

    // Single-char operator / punctuation. Consistent across both sides, so
    // splitting `===` into `=`,`=`,`=` cannot create a false difference.
    push(i, i + 1, false, ch)
    prev = ch
    i++
  }

  return tokens
}

// ---------------------------------------------------------------------------
// Myers diff (bounded)
// ---------------------------------------------------------------------------

/**
 * Myers O(ND) diff over normalized token sequences. Returns `null` when the
 * edit distance exceeds `maxEdits`, which bounds a huge/wholly-different band
 * instead of letting the trace grow without limit.
 */
export function myersDiff(a: BundleToken[], b: BundleToken[], maxEdits: number): DiffOp[] | null {
  const N = a.length
  const M = b.length
  const max = N + M
  const v = new Int32Array(2 * max + 1)
  const off = max
  const trace: Int32Array[] = []
  let found = false

  for (let d = 0; d <= max; d++) {
    if (d > maxEdits) return null
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) x = v[off + k + 1]
      else x = v[off + k - 1] + 1
      let y = x - k
      while (x < N && y < M && a[x].norm === b[y].norm) {
        x++
        y++
      }
      v[off + k] = x
      if (x >= N && y >= M) {
        found = true
        break
      }
    }
    if (found) break
  }

  if (!found) return null

  const ops: DiffOp[] = []
  let x = N
  let y = M
  for (let d = trace.length - 1; d >= 0; d--) {
    const vv = trace[d]
    const k = x - y
    const down = k === -d || (k !== d && vv[off + k - 1] < vv[off + k + 1])
    const prevK = down ? k + 1 : k - 1
    const prevX = vv[off + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push({ op: 'eq', aIndex: x - 1, bIndex: y - 1 })
      x--
      y--
    }
    if (d > 0) {
      if (x === prevX) {
        ops.push({ op: 'ins', bIndex: y - 1 })
        y--
      } else {
        ops.push({ op: 'del', aIndex: x - 1 })
        x--
      }
    }
  }
  ops.reverse()
  return ops
}

// ---------------------------------------------------------------------------
// Run extraction
// ---------------------------------------------------------------------------

function collectRuns(ops: DiffOp[], a: BundleToken[], b: BundleToken[], minRun: number): BundleRun[] {
  const runs: BundleRun[] = []
  let pending: { side: 'reference' | 'target'; indices: number[] } | null = null

  const flush = (): void => {
    if (!pending || pending.indices.length < minRun) {
      pending = null
      return
    }
    const tokens = pending.side === 'reference' ? a : b
    const first = tokens[pending.indices[0]]
    const last = tokens[pending.indices[pending.indices.length - 1]]
    // `text` is filled from the verbatim source by the caller; the tokenizer
    // dropped whitespace, so stitching tokens would not reproduce it.
    runs.push({ side: pending.side, start: first.start, end: last.end, tokens: pending.indices.length, text: '' })
    pending = null
  }

  for (const op of ops) {
    if (op.op === 'eq') {
      flush()
      continue
    }
    const side = op.op === 'del' ? 'reference' : 'target'
    if (pending && pending.side !== side) flush()
    if (!pending) pending = { side, indices: [] }
    pending.indices.push(op.op === 'del' ? op.aIndex : op.bIndex)
  }
  flush()
  return runs
}

function diffToStats(a: BundleToken[], b: BundleToken[], ops: DiffOp[]): DiffStats {
  let eq = 0
  let ins = 0
  let del = 0
  for (const op of ops) {
    if (op.op === 'eq') eq++
    else if (op.op === 'ins') ins++
    else del++
  }
  return { tokensReference: a.length, tokensTarget: b.length, eq, ins, del, identical: ins === 0 && del === 0 }
}

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

export type SegmentOptions = { startAnchor: string; endAnchor: string; maxEdits?: number; minRun?: number }

export function diffSegment(reference: string, target: string, options: SegmentOptions): DiffResult {
  const { startAnchor, endAnchor } = options
  const aStart = reference.indexOf(startAnchor)
  const bStart = target.indexOf(startAnchor)
  if (aStart < 0) throw new Error(`reference does not contain start anchor ${JSON.stringify(startAnchor)}`)
  if (bStart < 0) throw new Error(`target does not contain start anchor ${JSON.stringify(startAnchor)}`)
  const aEnd = reference.indexOf(endAnchor, aStart)
  const bEnd = target.indexOf(endAnchor, bStart)
  if (aEnd < 0) throw new Error(`reference has no end anchor ${JSON.stringify(endAnchor)} after start`)
  if (bEnd < 0) throw new Error(`target has no end anchor ${JSON.stringify(endAnchor)} after start`)

  const aTo = aEnd + endAnchor.length
  const bTo = bEnd + endAnchor.length
  const a = tokenize(reference.slice(aStart, aTo), aStart)
  const b = tokenize(target.slice(bStart, bTo), bStart)

  const scope: SegmentScope = {
    mode: 'segment',
    startAnchor,
    endAnchor,
    range: { reference: [aStart, aTo], target: [bStart, bTo] },
  }
  return buildResult(scope, a, b, reference, target, options.maxEdits ?? 2000, options.minRun ?? 2)
}

export type AroundOptions = { anchor: string; pad: number; maxEdits?: number; minRun?: number }

export function diffAround(reference: string, target: string, options: AroundOptions): DiffResult {
  const { anchor, pad } = options
  const aAt = reference.indexOf(anchor)
  const bAt = target.indexOf(anchor)
  if (aAt < 0) throw new Error(`reference does not contain anchor ${JSON.stringify(anchor)}`)
  if (bAt < 0) throw new Error(`target does not contain anchor ${JSON.stringify(anchor)}`)

  const aFrom = Math.max(0, aAt - pad)
  const bFrom = Math.max(0, bAt - pad)
  const aTo = Math.min(reference.length, aAt + anchor.length + pad)
  const bTo = Math.min(target.length, bAt + anchor.length + pad)
  const a = tokenize(reference.slice(aFrom, aTo), aFrom)
  const b = tokenize(target.slice(bFrom, bTo), bFrom)

  const scope: AroundScope = {
    mode: 'around',
    anchor,
    pad,
    range: { reference: [aFrom, aTo], target: [bFrom, bTo] },
  }
  return buildResult(scope, a, b, reference, target, options.maxEdits ?? 2000, options.minRun ?? 2)
}

function buildResult(
  scope: SegmentScope | AroundScope,
  a: BundleToken[],
  b: BundleToken[],
  reference: string,
  target: string,
  maxEdits: number,
  minRun: number,
): DiffResult {
  const ops = myersDiff(a, b, maxEdits)
  if (!ops) {
    return {
      scope,
      stats: { tokensReference: a.length, tokensTarget: b.length, eq: 0, ins: 0, del: 0, identical: false },
      truncated: true,
      message: `edit distance exceeded maxEdits=${maxEdits}; raise --max-edits or use a narrower scope`,
      runs: [],
    }
  }
  const runs = collectRuns(ops, a, b, minRun).map((run) => ({
    ...run,
    text: (run.side === 'reference' ? reference : target).slice(run.start, run.end),
  }))
  return { scope, stats: diffToStats(a, b, ops), truncated: false, runs }
}

export type AnchorsOptions = {
  band?: [number, number]
  minLen?: number
  minChg?: number
  minExtra?: number
}

export function analyzeAnchors(reference: string, target: string, options: AnchorsOptions = {}): AnchorsResult {
  const minLen = options.minLen ?? 16
  const minChg = options.minChg ?? 40
  const minExtra = options.minExtra ?? 300
  const band = options.band ?? [0, target.length]

  const aAnchors = uniqueLiteralMap(reference, minLen)
  const bAnchors = uniqueLiteralMap(target, minLen)

  const rows: Array<{ targetPos: number; targetLen: number; referencePos: number; referenceLen: number }> = []
  for (const [value, b] of bAnchors) {
    const a = aAnchors.get(value)
    if (!a) continue
    rows.push({ targetPos: b.pos, targetLen: b.len, referencePos: a.pos, referenceLen: a.len })
  }
  rows.sort((x, y) => x.targetPos - y.targetPos)

  const changePoints: DeltaChangePoint[] = []
  let prevDelta: number | null = null
  for (const row of rows) {
    const delta = row.targetPos - row.referencePos
    if (prevDelta === null || Math.abs(delta - prevDelta) >= minChg) {
      changePoints.push({
        targetPos: row.targetPos,
        referencePos: row.referencePos,
        delta,
        chg: prevDelta === null ? 0 : delta - prevDelta,
      })
    }
    prevDelta = delta
  }

  const bigInsertions: BigInsertion[] = []
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1]
    const r = rows[i]
    if (r.targetPos < band[0] || p.targetPos > band[1]) continue
    const bGap = r.targetPos - (p.targetPos + p.targetLen)
    const aGap = r.referencePos - (p.referencePos + p.referenceLen)
    if (bGap - aGap < minExtra) continue
    const extra = trimToInsertion(
      target.slice(p.targetPos + p.targetLen, r.targetPos),
      reference.slice(p.referencePos + p.referenceLen, r.referencePos),
    )
    bigInsertions.push({ targetStart: p.targetPos + p.targetLen, targetEnd: r.targetPos, extra })
  }

  const scope: AnchorsScope = { mode: 'anchors', band, minLen, minChg, minExtra }
  return { scope, anchorCount: rows.length, changePoints, bigInsertions }
}

// Trim a common prefix/suffix so the reported insertion excludes unchanged
// context, mirroring how a human would read the extra block.
function trimToInsertion(targetGap: string, referenceGap: string): string {
  let pre = 0
  while (pre < targetGap.length && pre < referenceGap.length && targetGap[pre] === referenceGap[pre]) pre++
  let tEnd = targetGap.length
  let rEnd = referenceGap.length
  while (tEnd > pre && rEnd > pre && targetGap[tEnd - 1] === referenceGap[rEnd - 1]) {
    tEnd--
    rEnd--
  }
  return targetGap.slice(pre, tEnd)
}

function uniqueLiteralMap(source: string, minLen: number): Map<string, { pos: number; len: number }> {
  const map = new Map<string, { pos: number; len: number } | null>()
  // Reuse the tokenizer so template/regex spans are handled; keep only literal
  // tokens (non-identifier) whose verbatim text is long enough.
  for (const token of tokenize(source)) {
    if (token.isIdentifier) continue
    const text = token.raw
    if (text.length < minLen) continue
    if (map.has(text)) map.set(text, null)
    else map.set(text, { pos: token.start, len: text.length })
  }
  const out = new Map<string, { pos: number; len: number }>()
  for (const [value, entry] of map) {
    if (entry) out.set(value, entry)
  }
  return out
}
