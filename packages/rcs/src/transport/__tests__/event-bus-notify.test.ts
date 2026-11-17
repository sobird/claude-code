import { beforeEach, expect, test } from 'bun:test'

import { loadConfig } from '../../config.js'
import { createMemoryRepositories } from '../../db/repositories/index.js'
import { initPushNotifier, resetPushNotifierForTests } from '../../services/push-notifier.js'
import { publishInboundEvent } from '../event-bus.js'

const confirmation = {
  request_id: 'req-9',
  request: { subtype: 'can_use_tool', tool_name: 'Edit', description: 'Edit file' },
}

beforeEach(() => resetPushNotifierForTests())

test('publishing an inbound confirmation reaches the owner’s subscription', async () => {
  const repos = createMemoryRepositories()
  const user = await repos.users.create({ username: 'notify-owner', passwordHash: 'x', role: 'member' })
  const session = await repos.sessions.create({ ownerUserId: user.id, title: 'Edit things' })
  await repos.pushSubscriptions.upsertForUser(user.id, { endpoint: 'https://e/1', p256dh: 'k', auth: 'a' })

  const sent: unknown[] = []
  await initPushNotifier({
    config: loadConfig({
      RCS_AUTH_SECRET: 'x',
      RCS_VAPID_PUBLIC_KEY: 'p',
      RCS_VAPID_PRIVATE_KEY: 's',
    } as unknown as NodeJS.ProcessEnv),
    repos,
    provider: {
      setVapidDetails: () => {},
      generateVapidKeys: () => ({ publicKey: 'p', privateKey: 's' }),
      async sendNotification(_sub, payload) {
        sent.push(JSON.parse(payload))
      },
    },
  })

  await publishInboundEvent(repos, null, session.id, 'control_request', confirmation)
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatchObject({ sessionId: session.id, toolName: 'Edit', kind: 'permission' })
})

test('publishing an outbound-style event type does not notify', async () => {
  const repos = createMemoryRepositories()
  const user = await repos.users.create({ username: 'notify-owner2', passwordHash: 'x', role: 'member' })
  const session = await repos.sessions.create({ ownerUserId: user.id })
  await repos.pushSubscriptions.upsertForUser(user.id, { endpoint: 'https://e/2', p256dh: 'k', auth: 'a' })

  const sent: unknown[] = []
  await initPushNotifier({
    config: loadConfig({
      RCS_AUTH_SECRET: 'x',
      RCS_VAPID_PUBLIC_KEY: 'p',
      RCS_VAPID_PRIVATE_KEY: 's',
    } as unknown as NodeJS.ProcessEnv),
    repos,
    provider: {
      setVapidDetails: () => {},
      generateVapidKeys: () => ({ publicKey: 'p', privateKey: 's' }),
      async sendNotification(_sub, payload) {
        sent.push(JSON.parse(payload))
      },
    },
  })

  await publishInboundEvent(repos, null, session.id, 'assistant', { message: { content: 'hi' }, uuid: 'u1' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(sent).toHaveLength(0)
})
