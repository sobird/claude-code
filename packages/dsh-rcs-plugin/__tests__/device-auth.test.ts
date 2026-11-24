import { describe, expect, test } from 'bun:test'

import { FakeRcs } from '@sobird/dsh-bridge/testing'

import { DeviceAuthClient, DeviceAuthError, type DeviceFetch } from '../src/device-auth'

const GRANT = {
  device_code: 'device-code-1234567890abcdef',
  user_code: 'ABCD-2345',
  verification_uri: 'https://rcs.example.com/device',
  verification_uri_complete: 'https://rcs.example.com/device#code=ABCD-2345',
  expires_in: 600,
  interval: 5,
}

describe('DeviceAuthClient', () => {
  test('requestCode posts without an Authorization header and maps the grant', async () => {
    const requests: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[] = []
    const fetchImpl: DeviceFetch = async (url, init) => {
      requests.push({ url, init })
      return new Response(JSON.stringify(GRANT), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    const client = new DeviceAuthClient({ baseUrl: 'https://rcs.example.com/', fetch: fetchImpl })
    const grant = await client.requestCode({ client: 'dsh-rcs-plugin', hostname: 'mac' })

    expect(grant).toEqual({
      deviceCode: GRANT.device_code,
      userCode: GRANT.user_code,
      verificationUri: GRANT.verification_uri,
      verificationUriComplete: GRANT.verification_uri_complete,
      expiresIn: 600,
      interval: 5,
    })
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://rcs.example.com/v1/auth/device/code')
    expect(requests[0].init?.method).toBe('POST')
    expect(requests[0].init?.headers?.authorization).toBeUndefined()
    expect(JSON.parse(requests[0].init?.body ?? '{}')).toEqual({ client: 'dsh-rcs-plugin', hostname: 'mac' })
  })

  test('falls back to verification_uri when the server omits the complete link', async () => {
    const { verification_uri_complete: _omitted, ...legacyGrant } = GRANT
    const fetchImpl: DeviceFetch = async () =>
      new Response(JSON.stringify(legacyGrant), { status: 200, headers: { 'content-type': 'application/json' } })
    const client = new DeviceAuthClient({ baseUrl: 'https://rcs.example.com', fetch: fetchImpl })

    const grant = await client.requestCode({ client: 'dsh-rcs-plugin' })
    expect(grant.verificationUriComplete).toBe(grant.verificationUri)
  })

  test('a non-2xx response throws an error carrying the status', async () => {
    const fetchImpl: DeviceFetch = async () => new Response('nope', { status: 500 })
    const client = new DeviceAuthClient({ baseUrl: 'https://rcs.example.com', fetch: fetchImpl })

    let caught: unknown
    try {
      await client.requestCode({ client: 'dsh-rcs-plugin' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(DeviceAuthError)
    expect(caught instanceof DeviceAuthError ? caught.status : undefined).toBe(500)
  })

  test('pollToken walks pending → approved and throws on unknown codes', async () => {
    const rcs = new FakeRcs()
    rcs.start()
    try {
      rcs.deviceTokenStates.push(
        { status: 'pending' },
        { status: 'approved', api_key: 'rcs_paired', prefix: 'rcs_paired', name: 'dsh @ mac' },
      )
      const client = new DeviceAuthClient({ baseUrl: rcs.origin })

      expect(await client.pollToken('device-code')).toEqual({ status: 'pending', apiKey: undefined })
      expect(await client.pollToken('device-code')).toEqual({ status: 'approved', apiKey: 'rcs_paired' })

      let caught: unknown
      try {
        await client.pollToken('device-code')
      } catch (error) {
        caught = error
      }
      expect(caught instanceof DeviceAuthError ? caught.status : undefined).toBe(404)
    } finally {
      rcs.stop()
    }
  })

  test('requestCode reaches the fake server', async () => {
    const rcs = new FakeRcs()
    rcs.start()
    try {
      const client = new DeviceAuthClient({ baseUrl: rcs.origin })
      const grant = await client.requestCode({ client: 'dsh-rcs-plugin', hostname: 'mac' })
      expect(grant.userCode).toBe('ABCD-2345')
      expect(rcs.deviceCodeRequests.at(-1)).toEqual({ client: 'dsh-rcs-plugin', hostname: 'mac' })
    } finally {
      rcs.stop()
    }
  })
})
