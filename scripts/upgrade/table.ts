/**
 * Structured constant-table extraction and diff.
 *
 * `inventory` only sees strings whose values changed; edits inside object
 * literal tables (allowlists, flag sets, callback registrations) are invisible
 * to it. This locates an object literal by an anchor property name, serializes
 * its literal subtree to JSON without evaluating bundle code, and diffs two
 * snapshots (bundle vs baseline JSON, or bundle vs a src export).
 */

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import ts from 'typescript'

export type TableDiff = {
  added: Array<{ path: string; value: unknown }>
  removed: Array<{ path: string; value: unknown }>
  changed: Array<{ path: string; baseline: unknown; target: unknown }>
}

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

function propertyName(name: ts.PropertyName, sourceFile: ts.SourceFile): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  // Computed names need an explicit sourceFile: nodes were created without
  // parent pointers, so the implicit `getSourceFile()` lookup would fail.
  return name.getText(sourceFile)
}

// Only literal-shaped subtrees are serializable. Anything executable (a call,
// a complex expression) is rejected instead of being evaluated: the bundle is
// untrusted input, and silently skipping it would hide table entries.
export function literalToJson(node: ts.Node, sourceFile: ts.SourceFile): unknown {
  const value = unwrap(node)
  const where = () => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(value.getStart(sourceFile))
    return `${line + 1}:${character}`
  }

  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text
  if (ts.isNumericLiteral(value)) return Number(value.text)
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false
  if (value.kind === ts.SyntaxKind.NullKeyword) return null
  // Callbacks are recorded as presence markers: minified names/bodies change
  // every release, the registration itself is what matters. This mirrors how
  // `valueToJson` serializes functions from a src export.
  if (ts.isIdentifier(value) || ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
    return { $ident: true }
  }

  if (ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand)) {
    const magnitude = Number(value.operand.text)
    if (value.operator === ts.SyntaxKind.MinusToken) return -magnitude
    if (value.operator === ts.SyntaxKind.PlusToken) return magnitude
    // Minifiers emit `!0` / `!1` for true / false.
    if (value.operator === ts.SyntaxKind.ExclamationToken && (magnitude === 0 || magnitude === 1)) {
      return magnitude === 0
    }
  }
  if (ts.isVoidExpression(value) && ts.isNumericLiteral(value.expression) && Number(value.expression.text) === 0) {
    return { $undefined: true }
  }

  if (ts.isArrayLiteralExpression(value)) {
    return value.elements.map((element) => literalToJson(element, sourceFile))
  }

  if (ts.isObjectLiteralExpression(value)) {
    const result: Record<string, unknown> = {}
    for (const property of value.properties) {
      if (ts.isPropertyAssignment(property)) {
        result[propertyName(property.name, sourceFile)] = literalToJson(property.initializer, sourceFile)
      } else if (ts.isShorthandPropertyAssignment(property)) {
        result[property.name.text] = { $ident: true }
      } else {
        throw new Error(`table: unsupported object property ${ts.SyntaxKind[property.kind]} at ${where()}`)
      }
    }
    return result
  }

  throw new Error(`table: unsupported syntax ${ts.SyntaxKind[value.kind]} at ${where()}`)
}

// `whole: false` (default) returns the value of the anchored key; `whole: true`
// returns the object literal that *contains* the key, which is what a §1.5
// whole-table comparison needs (e.g. all 84 cmdlet allowlist entries).
export function extractTable(
  source: string,
  anchor: string,
  fileName = 'bundle.js',
  options: { whole?: boolean } = {},
): unknown {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    { languageVersion: ts.ScriptTarget.Latest },
    false,
    ts.ScriptKind.JS,
  )
  let found: ts.Node | undefined

  const visit = (node: ts.Node): void => {
    if (found) return
    if (options.whole && ts.isObjectLiteralExpression(node)) {
      const hasAnchor = node.properties.some(
        (property) => ts.isPropertyAssignment(property) && propertyName(property.name, sourceFile) === anchor,
      )
      if (hasAnchor) {
        found = node
        return
      }
    }
    if (!options.whole && ts.isPropertyAssignment(node) && propertyName(node.name, sourceFile) === anchor) {
      const initializer = unwrap(node.initializer)
      if (ts.isObjectLiteralExpression(initializer)) found = initializer
    }
    node.forEachChild(visit)
  }
  visit(sourceFile)

  if (!found) throw new Error(`table: no object literal anchored at "${anchor}"`)
  return literalToJson(found, sourceFile)
}

// Convert a runtime value (a src export) to the same JSON shape as the bundle
// walk. Functions become presence markers so minified/renamed callbacks compare
// equal; Maps/Sets are normalized for stable output.
export function valueToJson(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (value === undefined) return { $undefined: true }
  if (typeof value === 'function') return { $ident: true }
  if (typeof value !== 'object') return String(value as symbol | bigint)
  if (seen.has(value)) throw new Error('table: circular value')
  seen.add(value)

  if (Array.isArray(value)) return value.map((item) => valueToJson(item, seen))
  if (value instanceof Map) {
    const result: Record<string, unknown> = {}
    for (const [key, item] of value) result[String(key)] = valueToJson(item, seen)
    return result
  }
  if (value instanceof Set) return [...value].map((item) => valueToJson(item, seen))

  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) result[key] = valueToJson(item, seen)
  return result
}

export async function loadSrcTable(
  repoRoot: string,
  specifier: string,
  options: { anchor?: string; whole?: boolean } = {},
): Promise<unknown> {
  const [file, exportName] = specifier.split('#')
  if (!file || !exportName) throw new Error('table: --src must be <path>#<export>')
  const module = (await import(pathToFileURL(resolve(repoRoot, file)).href)) as Record<string, unknown>
  if (!(exportName in module)) throw new Error(`table: ${file} does not export ${exportName}`)
  const exported = module[exportName]
  // `--whole` compares the full export; otherwise pick the anchored key so the
  // src value lines up with `extractTable`'s default (entry) shape.
  if (!options.whole && options.anchor && isPlainObject(exported) && options.anchor in exported) {
    return valueToJson(exported[options.anchor])
  }
  return valueToJson(exported)
}

const isPrimitive = (value: unknown): boolean => value === null || typeof value !== 'object'

export function diffTables(baseline: unknown, target: unknown): TableDiff {
  const diff: TableDiff = { added: [], removed: [], changed: [] }

  const walk = (path: string, before: unknown, after: unknown): void => {
    if (Array.isArray(before) && Array.isArray(after)) {
      if (before.every(isPrimitive) && after.every(isPrimitive)) {
        const beforeKeys = new Set(before.map((item) => JSON.stringify(item)))
        const afterKeys = new Set(after.map((item) => JSON.stringify(item)))
        for (const item of after) {
          if (!beforeKeys.has(JSON.stringify(item))) diff.added.push({ path: `${path}[]`, value: item })
        }
        for (const item of before) {
          if (!afterKeys.has(JSON.stringify(item))) diff.removed.push({ path: `${path}[]`, value: item })
        }
        return
      }
      const length = Math.max(before.length, after.length)
      for (let i = 0; i < length; i++) walk(`${path}[${i}]`, before[i], after[i])
      return
    }

    if (isPlainObject(before) && isPlainObject(after)) {
      const keys = new Set([...Object.keys(before), ...Object.keys(after)])
      for (const key of [...keys].toSorted()) {
        const child = path ? `${path}.${key}` : key
        if (!(key in before)) diff.added.push({ path: child, value: after[key] })
        else if (!(key in after)) diff.removed.push({ path: child, value: before[key] })
        else walk(child, before[key], after[key])
      }
      return
    }

    if (JSON.stringify(before) !== JSON.stringify(after)) {
      diff.changed.push({ path: path || '<root>', baseline: before, target: after })
    }
  }

  walk('', baseline, target)
  return diff
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isEmptyDiff(diff: TableDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0
}
