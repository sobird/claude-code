import { createHash } from 'node:crypto'

import ts from 'typescript'

const IDENT_LIKE = new Set([ts.SyntaxKind.Identifier, ts.SyntaxKind.PrivateIdentifier])

export function fingerprintFunction(node: ts.Node): string {
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
  const literals = [...strings]
    .toSorted()
    .map((value) => JSON.stringify(value))
    .join(' ')
  const source = literals ? `${body} strings[${literals}]` : body
  return createHash('sha256').update(source).digest('hex').slice(0, 16)
}
