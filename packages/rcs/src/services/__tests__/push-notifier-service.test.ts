import { beforeEach, describe, expect, test } from 'bun:test'

import { loadConfig } from '../../config.js'
import { toWebSessionId } from '../../contracts.js'
import { createMemoryRepositories } from '../../db/repositories/index.js'
import { connectPresence, resetPresenceForTests, setPresenceVisible } from '../presence.js'
import {
  getPushPublicConfig,
  initPushNotifier,
  notifyInboundEvent,
  resetPushNotifierForTests,
  type PushNotifierProvider,
} from '../push-notifier.js'

function fakeProvider(overrides: Partial<PushNotifierProvider> = {}) {
  const sent: Array<{ endpoint: string; payload: unknown }> = []
  const provider: PushNotifierProvider = {
    setVapidDetails: () => {},
    generateVapidKeys: () => ({ publicKey: 'generated-pub', privateKey: 'generated-priv' }),
    async sendNotification(subscription, payload) {
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) })
    },
    ...overrides,
  }
  return { provider, sent }
}

const confirmation = {
  request_id: 'req-1',
  request: { subtype: 'can_use_tool', tool_name: 'Bash', description: 'Run tests' },
}

async function seedSession(repos: ReturnType<typeof createMemoryRepositories>) {
  const user = await repos.users.create({ username: 'push-owner', passwordHash: 'x', role: 'member' })
  const session = await repos.sessions.create({ ownerUserId: user.id, title: 'Fix tests' })
  return { user, session }
}

function config(overrides: Record<string, string> = {}) {
  return loadConfig({
    RCS_AUTH_SECRET: 'x',
    RCS_VAPID_PUBLIC_KEY: 'pub',
    RCS_VAPID_PRIVATE_KEY: 'priv',
    ...overrides,
  } as unknown as NodeJS.ProcessEnv)
}

// A real VAPID key pair: the real `web-push` `setVapidDetails` validates the
// base64url key material, so placeholder strings would be rejected.
const REAL_VAPID_PUBLIC_KEY = 'BM5UyYwR6QU20IEcZBlGJAD0a5BqlTbeJGv2yG1Up_gmDYspF00LiuH-VKGkF2KR9_rEYo0Ykml3D4zzRBkwTYE'
const REAL_VAPID_PRIVATE_KEY = '-Gavixvdemehu1VOZ5SonwhgpJ9g7TkvUxlWHbM3MCE'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  resetPushNotifierForTests()
  resetPresenceForTests()
})

describe('push notifier service', () => {
  test('does nothing before initialization', async () => {
    const repos = createMemoryRepositories()
    const { sent } = fakeProvider()
    const { user, session } = await seedSession(repos)
    await repos.pushSubscriptions.upsertForUser(user.id, {
      endpoint: 'https://push.example/a',
      p256dh: 'p1',
      auth: 'a1',
    })

    notifyInboundEvent(session.id, 'control_request', confirmation)
    await flush()

    expect(sent).toHaveLength(0)
  })

  test('sends to every subscription of the owner with the right payload', async () => {
    const repos = createMemoryRepositories()
    const { provider, sent } = fakeProvider()
    const { user, session } = await seedSession(repos)
    await repos.pushSubscriptions.upsertForUser(user.id, {
      endpoint: 'https://push.example/a',
      p256dh: 'p1',
      auth: 'a1',
    })
    await repos.pushSubscriptions.upsertForUser(user.id, {
      endpoint: 'https://push.example/b',
      p256dh: 'p2',
      auth: 'a2',
    })

    await initPushNotifier({ config: config(), repos, provider })
    notifyInboundEvent(session.id, 'control_request', confirmation)
    await flush()

    expect(sent.map((entry) => entry.endpoint).toSorted()).toEqual(['https://push.example/a', 'https://push.example/b'])
    for (const entry of sent) {
      const payload = entry.payload as { sessionId: string; toolName: string; kind: string }
      expect(payload.sessionId).toBe(toWebSessionId(session.id))
      expect(payload.toolName).toBe('Bash')
      expect(payload.kind).toBe('permission')
    }
  })

  test('ignores sessions without an owner', async () => {
    const repos = createMemoryRepositories()
    const { provider, sent } = fakeProvider()
    const session = await repos.sessions.create({ ownerUserId: null, title: 'Unowned' })

    await initPushNotifier({ config: config(), repos, provider })
    notifyInboundEvent(session.id, 'control_request', confirmation)
    await flush()

    expect(sent).toHaveLength(0)
  })

  test('ignores non-confirmation events', async () => {
    const repos = createMemoryRepositories()
    const { provider, sent } = fakeProvider()
    const { user, session } = await seedSession(repos)
    await repos.pushSubscriptions.upsertForUser(user.id, {
      endpoint: 'https://push.example/a',
      p256dh: 'p1',
      auth: 'a1',
    })

    await initPushNotifier({ config: config(), repos, provider })
    notifyInboundEvent(session.id, 'user', { message: 'hi' })
    await flush()

    expect(sent).toHaveLength(0)
  })

  test('skips the push while a client is visibly on the session, then sends once it leaves', async () => {
    const repos = createMemoryRepositories()
    const { provider, sent } = fakeProvider()
    const { user, session } = await seedSession(repos)
    await repos.pushSubscriptions.upsertForUser(user.id, {
      endpoint: 'https://push.example/a',
      p256dh: 'p1',
      auth: 'a1',
    })

    await initPushNotifier({ config: config(), repos, provider })
    const release = connectPresence(session.id, 'c1')
    setPresenceVisible(session.id, 'c1', true)
    notifyInboundEvent(session.id, 'control_request', confirmation)
    await flush()

    expect(sent).toHaveLength(0)

    release()
    notifyInboundEvent(session.id, 'control_request', confirmation)
    await flush()

    expect(sent).toHaveLength(1)
  })

  test('still sends while the connected client is hidden', async () => {
    const repos = createMemoryRepositories()
    const { provider, sent } = fakeProvider()
    const { user, session } = await seedSession(repos)
    await repos.pushSubscriptions.upsertForUser(user.id, {
      endpoint: 'https://push.example/a',
      p256dh: 'p1',
      auth: 'a1',
    })

    await initPushNotifier({ config: config(), repos, provider })
    const release = connectPresence(session.id, 'c1')
    setPresenceVisible(session.id, 'c1', false)
    notifyInboundEvent(session.id, 'control_request', confirmation)
    await flush()

    expect(sent).toHaveLength(1)
    release()
  })

  test('drops a 410 subscription and keeps sending to the rest', async () => {
    const repos = createMemoryRepositories()
    const { provider, sent } = fakeProvider({
      async sendNotification(subscription, payload) {
        if (subscription.endpoint === 'https://push.example/a') {
          throw Object.assign(new Error('gone'), { statusCode: 410 })
        }
        sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) })
      },
    })
    const { user, session } = await seedSession(repos)
    await repos.pushSubscriptions.upsertForUser(user.id, {
      endpoint: 'https://push.example/a',
      p256dh: 'p1',
      auth: 'a1',
    })
    await repos.pushSubscriptions.upsertForUser(user.id, {
      endpoint: 'https://push.example/b',
      p256dh: 'p2',
      auth: 'a2',
    })

    await initPushNotifier({ config: config(), repos, provider })
    notifyInboundEvent(session.id, 'control_request', confirmation)
    await flush()

    const remaining = await repos.pushSubscriptions.listByUser(user.id)
    expect(remaining.map((entry) => entry.endpoint)).not.toContain('https://push.example/a')
    expect(remaining.map((entry) => entry.endpoint)).toContain('https://push.example/b')
    expect(sent.map((entry) => entry.endpoint)).toEqual(['https://push.example/b'])
  })

  test('dedupes the same request id', async () => {
    const repos = createMemoryRepositories()
    const { provider, sent } = fakeProvider()
    const { user, session } = await seedSession(repos)
    await repos.pushSubscriptions.upsertForUser(user.id, {
      endpoint: 'https://push.example/a',
      p256dh: 'p1',
      auth: 'a1',
    })

    await initPushNotifier({ config: config(), repos, provider })
    notifyInboundEvent(session.id, 'control_request', confirmation)
    notifyInboundEvent(session.id, 'control_request', confirmation)
    await flush()

    expect(sent).toHaveLength(1)
  })

  test('waits for initialization when notified during init', async () => {
    const repos = createMemoryRepositories()
    const { provider, sent } = fakeProvider()
    const { user, session } = await seedSession(repos)
    await repos.pushSubscriptions.upsertForUser(user.id, {
      endpoint: 'https://push.example/a',
      p256dh: 'p1',
      auth: 'a1',
    })

    const initPromise = initPushNotifier({ config: config(), repos, provider })
    notifyInboundEvent(session.id, 'control_request', confirmation)
    await initPromise
    await flush()

    expect(sent).toHaveLength(1)
    expect(sent[0].endpoint).toBe('https://push.example/a')
    const payload = sent[0].payload as { sessionId: string; toolName: string; kind: string }
    expect(payload.sessionId).toBe(toWebSessionId(session.id))
    expect(payload.toolName).toBe('Bash')
    expect(payload.kind).toBe('permission')
  })

  test('uses stored VAPID keys when env is absent', async () => {
    const repos = createMemoryRepositories()
    const vapidCalls: Array<[string, string, string]> = []
    const { provider } = fakeProvider({
      setVapidDetails(subject, publicKey, privateKey) {
        vapidCalls.push([subject, publicKey, privateKey])
      },
    })
    await repos.pushSettings.set({
      publicKey: 'stored',
      privateKey: 'stored-priv',
      subject: 'mailto:ops@example.com',
    })

    await initPushNotifier({
      config: config({ RCS_VAPID_PUBLIC_KEY: '', RCS_VAPID_PRIVATE_KEY: '' }),
      repos,
      provider,
    })

    expect(getPushPublicConfig()).toEqual({ enabled: true, publicKey: 'stored' })
    expect(vapidCalls).toHaveLength(1)
    // The subject is deployment config: the stored row's subject is ignored so a
    // fixed default repairs rows persisted by older boots.
    expect(vapidCalls[0][0]).toBe('mailto:noreply@example.com')
    expect(vapidCalls[0][1]).toBe('stored')
  })

  test('uses stored VAPID keys when env is partially set', async () => {
    const repos = createMemoryRepositories()
    const vapidCalls: Array<[string, string, string]> = []
    const { provider } = fakeProvider({
      setVapidDetails(subject, publicKey, privateKey) {
        vapidCalls.push([subject, publicKey, privateKey])
      },
    })
    await repos.pushSettings.set({
      publicKey: 'stored',
      privateKey: 'stored-priv',
      subject: 'mailto:ops@example.com',
    })

    await initPushNotifier({ config: config({ RCS_VAPID_PRIVATE_KEY: '' }), repos, provider })

    expect(getPushPublicConfig()).toEqual({ enabled: true, publicKey: 'stored' })
    expect(vapidCalls).toHaveLength(1)
    expect(vapidCalls[0][0]).toBe('mailto:noreply@example.com')
    expect(vapidCalls[0][1]).toBe('stored')
  })

  test('generates and persists keys when neither exists', async () => {
    const repos = createMemoryRepositories()
    const { provider } = fakeProvider()

    await initPushNotifier({
      config: config({ RCS_VAPID_PUBLIC_KEY: '', RCS_VAPID_PRIVATE_KEY: '' }),
      repos,
      provider,
    })

    const stored = await repos.pushSettings.get()
    expect(stored?.publicKey).toBe('generated-pub')
    expect(stored?.privateKey).toBe('generated-priv')
    expect(getPushPublicConfig()).toEqual({ enabled: true, publicKey: 'generated-pub' })
  })

  test('is disabled when only one env key is set and no stored row', async () => {
    const repos = createMemoryRepositories()
    const { provider, sent } = fakeProvider()
    const { user, session } = await seedSession(repos)
    await repos.pushSubscriptions.upsertForUser(user.id, {
      endpoint: 'https://push.example/a',
      p256dh: 'p1',
      auth: 'a1',
    })

    await initPushNotifier({ config: config({ RCS_VAPID_PRIVATE_KEY: '' }), repos, provider })

    expect(getPushPublicConfig()).toEqual({ enabled: false, publicKey: null })
    notifyInboundEvent(session.id, 'control_request', confirmation)
    await flush()
    expect(sent).toHaveLength(0)
  })

  // No `provider`: these load the real `web-push` package, proving it resolves
  // under Bun (the gateway bundle embeds the same module for the Docker image).
  test('loads the real web-push module and enables push with env keys', async () => {
    const repos = createMemoryRepositories()

    await initPushNotifier({
      config: config({
        RCS_VAPID_PUBLIC_KEY: REAL_VAPID_PUBLIC_KEY,
        RCS_VAPID_PRIVATE_KEY: REAL_VAPID_PRIVATE_KEY,
      }),
      repos,
    })

    expect(getPushPublicConfig()).toEqual({ enabled: true, publicKey: REAL_VAPID_PUBLIC_KEY })
  })

  test('generates and persists keys via the real web-push module', async () => {
    const repos = createMemoryRepositories()

    await initPushNotifier({
      config: config({ RCS_VAPID_PUBLIC_KEY: '', RCS_VAPID_PRIVATE_KEY: '' }),
      repos,
    })

    const stored = await repos.pushSettings.get()
    expect(stored?.publicKey).toBeTruthy()
    expect(stored?.privateKey).toBeTruthy()
    expect(getPushPublicConfig()).toEqual({ enabled: true, publicKey: stored?.publicKey ?? null })
  })
})
