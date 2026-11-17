import { describe, expect, test } from 'bun:test'

import { signInUrlHasError } from '../auth-redirect'

describe('signInUrlHasError', () => {
  test('detects Auth.js failure redirects', () => {
    expect(signInUrlHasError('http://localhost:3000/login?error=CredentialsSignin&code=credentials')).toBe(true)
    expect(signInUrlHasError('/login?error=CredentialsSignin')).toBe(true)
  })

  test('treats a completed sign-in as success', () => {
    expect(signInUrlHasError('http://localhost:3000/settings')).toBe(false)
    expect(signInUrlHasError('/')).toBe(false)
  })

  test('fails closed on unparseable input', () => {
    expect(signInUrlHasError('http://[::1')).toBe(true)
  })
})
