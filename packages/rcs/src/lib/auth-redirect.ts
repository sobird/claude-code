/**
 * Fail-closed detection of Auth.js sign-in error redirects.
 *
 * With `{ redirect: false }`, `signIn` does not throw on wrong credentials; it
 * returns the redirect URL carrying an `error` param instead. A completed
 * sign-in returns the target URL without one.
 */
export function signInUrlHasError(url: string): boolean {
  try {
    return new URL(url, 'http://localhost').searchParams.has('error')
  } catch {
    return true
  }
}
