import { createHash } from 'node:crypto'

import ts from 'typescript'

const IDENT_LIKE = new Set([ts.SyntaxKind.Identifier, ts.SyntaxKind.PrivateIdentifier])

export type FunctionSignature = {
  fingerprint: string
  // Sorted string literals emitted by the function. Fingerprints cover the
  // node skeleton; the literal set is exposed separately so pairing can score
  // how much two changed functions still talk about the same things.
  literals: string[]
}

export function functionSignature(node: ts.Node): FunctionSignature {
  const strings = new Set<string>()

  const emit = (n: ts.Node): string => {
    if (IDENT_LIKE.has(n.kind)) return 'Ident'
    if (n.kind === ts.SyntaxKind.StringLiteral) {
      strings.add((n as ts.StringLiteral).text)
      return ts.SyntaxKind[n.kind]
    }
    if (n.kind === ts.SyntaxKind.NumericLiteral) {
      return `${ts.SyntaxKind[n.kind]}:${(n as ts.NumericLiteral).text}`
    }
    const children: string[] = []
    n.forEachChild((child) => {
      children.push(emit(child))
    })
    return children.length ? `(${ts.SyntaxKind[n.kind]} ${children.join(' ')})` : ts.SyntaxKind[n.kind]
  }

  const body = emit(node)
  const literals = [...strings].toSorted()
  const serialized = literals.map((value) => JSON.stringify(value)).join(' ')
  const source = serialized ? `${body} strings[${serialized}]` : body
  const fingerprint = createHash('sha256').update(source).digest('hex').slice(0, 16)
  return { fingerprint, literals }
}

export function fingerprintFunction(node: ts.Node): string {
  return functionSignature(node).fingerprint
}
