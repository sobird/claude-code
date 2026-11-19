// Character-level scanner for JS string literals.
//
// Handles single/double-quoted strings, backslash escapes, template literals,
// line/block comments and regex literals. It is deliberately not a regex: the
// goal is to walk minified bundles one character at a time.
//
// Template literals: interpolated expressions are ignored. While inside a
// template, static text is accumulated; on `${` the accumulated text is
// discarded and the expression is skipped to its matching `}`. Whatever static
// text follows the final interpolation is emitted. A template with no
// interpolation therefore yields its whole body (plain -> plain), while
// interp-then-${x} yields nothing. This matches the task fixture.

// A `/` starts a regex literal when the previous non-whitespace character is
// one of these (it cannot be a division operator in those positions). `>` covers
// `=>/re/` in arrow bodies; `)` is deliberately absent because `(a+b)/2` is a
// division and misreading it swallows the rest of the file.
const REGEX_PRECEDERS = new Set(['=', '(', ':', ',', '[', '!', '&', '|', '?', '{', '}', ';', '>'])
// Keywords after which a `/` begins a regex rather than division (`return /x/`).
const REGEX_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'void',
  'delete',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
  'new',
])

// The identifier-like run immediately before `i`, ignoring whitespace. Used to
// tell `return /x/` from `a / b` without a full tokenizer.
function precedingWord(source: string, i: number): string {
  let end = i - 1
  while (end >= 0 && /\s/.test(source[end])) end--
  let start = end
  while (start >= 0 && /[A-Za-z0-9_$]/.test(source[start])) start--
  return source.slice(start + 1, end + 1)
}

function startsRegex(source: string, i: number, prev: string): boolean {
  return REGEX_PRECEDERS.has(prev) || REGEX_KEYWORDS.has(precedingWord(source, i))
}

export type LiteralRange = {
  value: string
  start: number
  end: number
  kind: 'string' | 'template' | 'regex'
}

// Positional scan: same walk as extractStringLiterals but keeps the source span
// of every literal, so evidence offsets can be validated as landing inside one.
export function scanLiterals(source: string): LiteralRange[] {
  const out: LiteralRange[] = []
  const n = source.length
  let i = 0
  // Last significant (non-whitespace) character seen in code context.
  let prev = ''

  while (i < n) {
    const ch = source[i]

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
      const { value, next } = readQuoted(source, i, ch)
      out.push({ value, start: i, end: next, kind: 'string' })
      i = next
      prev = ch
      continue
    }

    if (ch === '`') {
      const { value, next } = readTemplate(source, i)
      out.push({ value, start: i, end: next, kind: 'template' })
      i = next
      prev = '`'
      continue
    }

    if (ch === '/' && startsRegex(source, i, prev)) {
      const next = skipRegex(source, i)
      out.push({ value: '', start: i, end: next, kind: 'regex' })
      i = next
      prev = source[i - 1] ?? '/'
      continue
    }

    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') prev = ch
    i++
  }

  return out
}

export function extractStringLiterals(source: string): string[] {
  const out: string[] = []
  for (const literal of scanLiterals(source)) {
    // Regexes are not strings; templates with interpolation keep only the
    // trailing static segment, and an empty tail contributes nothing.
    if (literal.kind === 'regex') continue
    if (literal.kind === 'template' && literal.value.length === 0) continue
    out.push(literal.value)
  }
  return out
}

function readQuoted(source: string, start: number, quote: string): { value: string; next: number } {
  const n = source.length
  let i = start + 1
  let value = ''
  while (i < n) {
    const c = source[i]
    if (c === '\\') {
      if (i + 1 < n) {
        value += source[i + 1]
        i += 2
      } else {
        i++
      }
      continue
    }
    if (c === quote) {
      i++
      break
    }
    if (c === '\n') break
    value += c
    i++
  }
  return { value, next: i }
}

function readTemplate(source: string, start: number): { value: string; next: number } {
  const n = source.length
  let i = start + 1
  let value = ''
  while (i < n) {
    const c = source[i]
    if (c === '\\') {
      if (i + 1 < n) {
        value += source[i + 1]
        i += 2
      } else {
        i++
      }
      continue
    }
    if (c === '`') {
      i++
      break
    }
    if (c === '$' && source[i + 1] === '{') {
      value = ''
      i = skipInterpolation(source, i + 2)
      continue
    }
    value += c
    i++
  }
  return { value, next: i }
}

// Skip an interpolated `${ ... }` expression. `i` points just after `${`.
// Handles nested braces plus strings, templates and comments inside the
// expression; none of their contents are collected.
function skipInterpolation(source: string, i: number): number {
  const n = source.length
  let depth = 1
  // Fresh expression: a leading `/re/` must still be recognized.
  let prev = '{'
  while (i < n) {
    const c = source[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '"' || c === "'") {
      i = readQuoted(source, i, c).next
      prev = c
      continue
    }
    if (c === '`') {
      i = readTemplate(source, i).next
      prev = '`'
      continue
    }
    if (c === '/' && source[i + 1] === '/') {
      i += 2
      while (i < n && source[i] !== '\n') i++
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === '/' && startsRegex(source, i, prev)) {
      i = skipRegex(source, i)
      prev = source[i - 1] ?? '/'
      continue
    }
    if (c === '{') {
      depth++
      i++
      prev = '{'
      continue
    }
    if (c === '}') {
      depth--
      i++
      if (depth === 0) return i
      prev = '}'
      continue
    }
    if (!/\s/.test(c)) prev = c
    i++
  }
  return i
}

// Skip a regex literal starting at `start` (the leading `/`). Returns the index
// just past the literal and its flags.
function skipRegex(source: string, start: number): number {
  const n = source.length
  let i = start + 1
  let inClass = false
  while (i < n) {
    const c = source[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '[') {
      inClass = true
      i++
      continue
    }
    if (c === ']') {
      inClass = false
      i++
      continue
    }
    if (c === '/' && !inClass) {
      i++
      break
    }
    if (c === '\n') break
    i++
  }
  while (i < n && /[a-z]/i.test(source[i])) i++
  return i
}
