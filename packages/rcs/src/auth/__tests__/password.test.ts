import { expect, test } from 'bun:test'

import { hashPassword, verifyPassword } from '../password.js'

test('password round-trip', async () => {
  const encoded = await hashPassword('correct horse battery staple')
  expect(encoded.startsWith('scrypt$N=16384,r=8,p=1$')).toBe(true)
  expect(await verifyPassword('correct horse battery staple', encoded)).toBe(true)
})

test('wrong password is rejected', async () => {
  const encoded = await hashPassword('correct horse battery staple')
  expect(await verifyPassword('wrong password', encoded)).toBe(false)
})

test('malformed encodings are rejected without throwing', async () => {
  const malformed = [
    '',
    'plaintext',
    'scrypt$N=16384,r=8,p=1$onlythree',
    'scrypt$N=16384,r=8,p=1$$',
    'bcrypt$N=16384,r=8,p=1$c2FsdA==$aGFzaA==',
    'scrypt$N=1,r=8,p=1$c2FsdA==$aGFzaA==',
    'scrypt$N=16384,r=8,p=1$not-base64!$aGFzaA==',
    'scrypt$N=16384,r=8,p=1$c2FsdA==$aGFzaA==',
  ]
  for (const encoded of malformed) {
    expect(await verifyPassword('anything', encoded)).toBe(false)
  }
})

test('distinct salts produce distinct encodings', async () => {
  const a = await hashPassword('same-password')
  const b = await hashPassword('same-password')
  expect(a).not.toBe(b)
  expect(await verifyPassword('same-password', a)).toBe(true)
  expect(await verifyPassword('same-password', b)).toBe(true)
})
