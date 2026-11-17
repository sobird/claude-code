import { describe, expect, test } from 'bun:test'

import {
  detectPushState,
  subscriptionToRequest,
  urlBase64ToUint8Array,
  type PushEnvironment,
} from '../push-subscription.js'

const healthy: PushEnvironment = {
  secureContext: true,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  permission: 'default',
  isIos: false,
  isStandalone: false,
}

describe('detectPushState', () => {
  test('reports insecure even when every API exists', () => {
    expect(detectPushState({ ...healthy, secureContext: false })).toBe('insecure')
  })

  test('reports unsupported when a required API is missing', () => {
    expect(detectPushState({ ...healthy, hasPushManager: false })).toBe('unsupported')
    expect(detectPushState({ ...healthy, hasServiceWorker: false })).toBe('unsupported')
    expect(detectPushState({ ...healthy, hasNotification: false })).toBe('unsupported')
  })

  test('reports ios-needs-install for iOS outside standalone mode', () => {
    expect(detectPushState({ ...healthy, isIos: true, isStandalone: false })).toBe('ios-needs-install')
    expect(detectPushState({ ...healthy, isIos: true, isStandalone: true })).toBe('available')
  })

  test('reports denied when permission was refused', () => {
    expect(detectPushState({ ...healthy, permission: 'denied' })).toBe('denied')
  })

  test('reports available when everything is in place', () => {
    expect(detectPushState(healthy)).toBe('available')
    expect(detectPushState({ ...healthy, permission: 'granted' })).toBe('available')
  })
})

describe('urlBase64ToUint8Array', () => {
  test('decodes standard base64', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3])
  })

  test('pads and translates base64url alphabet', () => {
    expect(Array.from(urlBase64ToUint8Array('_-8'))).toEqual([255, 239])
  })
})

describe('subscriptionToRequest', () => {
  test('returns trimmed endpoint and keys', () => {
    expect(
      subscriptionToRequest({
        endpoint: '  https://push.example/abc  ',
        keys: { p256dh: '  key-dh  ', auth: '  secret  ' },
      }),
    ).toEqual({ endpoint: 'https://push.example/abc', keys: { p256dh: 'key-dh', auth: 'secret' } })
  })

  test('returns null when either key is missing', () => {
    const endpoint = 'https://push.example/abc'
    expect(subscriptionToRequest({ endpoint, keys: { auth: 'secret' } })).toBeNull()
    expect(subscriptionToRequest({ endpoint, keys: { p256dh: 'key-dh' } })).toBeNull()
    expect(subscriptionToRequest({ endpoint })).toBeNull()
  })
})
