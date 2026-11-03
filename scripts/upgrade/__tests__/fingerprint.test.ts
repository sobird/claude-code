import { expect, test } from 'bun:test'

import ts from 'typescript'

import { fingerprintFunction } from '../fingerprint'

function firstFn(code: string) {
  const sf = ts.createSourceFile('x.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let found: ts.Node | undefined
  const visit = (n: ts.Node) => {
    if (!found && (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n))) found = n
    n.forEachChild(visit)
  }
  visit(sf)
  return found!
}

test('stable across identifier renames', () => {
  const a = firstFn('function foo(x){return x+"lit"}')
  const b = firstFn('function bar(y){return y+"lit"}')
  expect(fingerprintFunction(a)).toBe(fingerprintFunction(b))
})

test('differs when literals differ', () => {
  const a = firstFn('function foo(x){return x+"one"}')
  const b = firstFn('function bar(y){return y+"two"}')
  expect(fingerprintFunction(a)).not.toBe(fingerprintFunction(b))
})
