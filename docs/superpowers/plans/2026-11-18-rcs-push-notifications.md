# RCS PWA Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify a user's subscribed devices, via Web Push, the moment any of their RCS sessions waits for a confirmation — even with the PWA closed.

**Architecture:** The gateway persists every inbound CLI event through `publishInboundEvent`; after persisting a `control_request` with `request.subtype === 'can_use_tool'`, a fire-and-forget notifier resolves the session owner and sends a Web Push to that user's stored subscriptions. The existing Serwist service worker shows the notification and focuses/opens `/{sessionId}` on click. A Settings card handles permission + subscription.

**Tech Stack:** Next.js 16 App Router, Serwist service worker (`@serwist/turbopack`), Hono gateway on Bun, Drizzle/Postgres, `web-push` (VAPID).

**Spec:** `docs/superpowers/specs/2026-11-18-rcs-push-notifications-design.md` (read it; this plan implements it).

**Working directory:** all commands below run in `packages/rcs` unless stated otherwise.

## Global Constraints

- Deployment is HTTPS (Caddy `RCS_DOMAIN`); Web Push needs a secure context. iOS needs 16.4+ and a home-screen install; this is manual verification, not code.
- Feature only fires for inbound `control_request` with `(payload.request ?? payload).subtype === 'can_use_tool'`. Never for outbound events or other subtypes.
- Sending must never block or fail event fan-out: call the notifier fire-and-forget, catch everything, ~5 s timeout per send.
- No top-level `import 'web-push'` in modules reachable from Next or client tests — load it dynamically inside the notifier (repo rule: no top-level await in the Ink chain).
- No CJK literals in `src/**/*.{ts,tsx}` (`src/__tests__/no-hardcoded-cjk.test.ts`); all copy goes in `messages/{en,zh-CN}.json` (both catalogs must share keys and ICU placeholders).
- Service worker registers **production only**; push cannot be exercised under `next dev`.
- Style: `.js` relative imports, no semicolons, single quotes, 2 spaces, 120 cols. Conventional commits.
- Every task ends with the targeted `bun test` passing. Before the final task: `bun run typecheck`, `bun run build:gateway`, and `bun run fmt` (repo root) pass; `bun run lint` only needs to be clean for changed files.

## Review Focus

- Replayed/duplicate `control_request` frames carry no `message_uuid`, so event dedupe does not cover them — the notifier must dedupe by `(sessionId, requestId)` for a short window (Task 3).
- A dead subscription (push service returns 404/410) must be deleted so it is not retried forever, while live subscriptions still receive the push (Task 3).
- A notification must be suppressed while the user already has that session visible, or they get alarmed by a banner for a card they are looking at (Task 6).
- Missing or very long session titles must still produce a usable notification title — generic fallback and truncation (Task 6).
- On iOS without a home-screen install, on plain HTTP, or with permission denied, Settings must explain the state instead of offering an Enable button that cannot work (Task 7).

---

### Task 1: Push tables, repositories, migration

**Files:**

- Modify: `src/db/schema.ts` (append two tables)
- Modify: `src/contracts.ts` (append records)
- Create: `src/db/repositories/push-subscriptions.ts`
- Create: `src/db/repositories/push-settings.ts`
- Modify: `src/db/repositories/types.ts` (interfaces + `Repositories`)
- Modify: `src/db/repositories/index.ts` (both factories + re-exports)
- Generate: `src/db/migrations/0007_*.sql` + `src/db/migrations/meta/*`
- Test: `src/db/__tests__/push-repositories.test.ts`

**Interfaces:**

- Produces (from `src/contracts.ts`):
  ```ts
  export interface PushSubscriptionRecord {
    id: string
    userId: string
    endpoint: string
    p256dh: string
    auth: string
    userAgent: string | null
    createdAt: Date
    updatedAt: Date
  }
  export interface PushVapidKeys {
    publicKey: string
    privateKey: string
    subject: string
  }
  ```
- Produces (from `src/db/repositories/types.ts`):

  ```ts
  export interface CreatePushSubscriptionInput {
    endpoint: string
    p256dh: string
    auth: string
    userAgent?: string | null
  }
  export interface PushSubscriptionRepository {
    /** Insert or update the row for this endpoint, reassigning it to `userId`. */
    upsertForUser(userId: string, input: CreatePushSubscriptionInput): Promise<PushSubscriptionRecord>
    /** Newest first. */
    listByUser(userId: string): Promise<PushSubscriptionRecord[]>
    deleteById(id: string): Promise<void>
    deleteByEndpoint(userId: string, endpoint: string): Promise<void>
  }
  export interface PushSettingsRepository {
    get(): Promise<PushVapidKeys | null>
    /** Upsert the single row (`id = 'default'`). */
    set(keys: PushVapidKeys): Promise<void>
  }
  ```

  `Repositories` gains `pushSubscriptions: PushSubscriptionRepository` and `pushSettings: PushSettingsRepository`.

- [ ] **Step 1: Add the schema tables**

Append to `src/db/schema.ts`, reusing the existing `createdAt()`/`updatedAt()` helpers:

```ts
export const pushSettings = pgTable('push_settings', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  subject: text('subject').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('push_subscriptions_user_idx').on(table.userId)],
)
```

- [ ] **Step 2: Generate the migration**

Run: `bun run db:generate`
Expected: a new `src/db/migrations/0007_*.sql` creating both tables and a journal entry. Inspect the SQL; it must include the unique index on `endpoint`, the `user_id` FK with `ON DELETE CASCADE`, and `push_settings.id` as PK.

- [ ] **Step 3: Write the failing repository tests**

Create `src/db/__tests__/push-repositories.test.ts` following the suite pattern in `environments-sessions-repo.test.ts` (PGlite + memory halves):

```ts
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPgliteDatabase, runMigrations } from '../client.js'
import { createMemoryUserRepositories, createUserRepositories } from '../repositories/index.js'
import type { Repositories } from '../repositories/index.js'

const ctx = await createPgliteDatabase()
await runMigrations(ctx.db)
afterAll(() => ctx.close())

function suite(name: string, makeRepos: () => Repositories): void {
  describe(name, () => {
    let repos: Repositories
    beforeEach(() => {
      repos = makeRepos()
    })

    test('upserting the same endpoint updates the row instead of adding one', async () => {
      const user = await repos.users.create({ username: 'push-a', passwordHash: 'x', role: 'member' })
      const first = await repos.pushSubscriptions.upsertForUser(user.id, {
        endpoint: 'https://e/1',
        p256dh: 'k1',
        auth: 'a1',
      })
      const second = await repos.pushSubscriptions.upsertForUser(user.id, {
        endpoint: 'https://e/1',
        p256dh: 'k2',
        auth: 'a2',
        userAgent: 'UA',
      })

      expect(second.id).toBe(first.id)
      expect(second.p256dh).toBe('k2')
      expect(second.userAgent).toBe('UA')
      expect(await repos.pushSubscriptions.listByUser(user.id)).toHaveLength(1)
    })

    test('re-registering an endpoint under another user moves it', async () => {
      const one = await repos.users.create({ username: 'push-b1', passwordHash: 'x', role: 'member' })
      const two = await repos.users.create({ username: 'push-b2', passwordHash: 'x', role: 'member' })
      await repos.pushSubscriptions.upsertForUser(one.id, { endpoint: 'https://e/2', p256dh: 'k', auth: 'a' })
      await repos.pushSubscriptions.upsertForUser(two.id, { endpoint: 'https://e/2', p256dh: 'k', auth: 'a' })

      expect(await repos.pushSubscriptions.listByUser(one.id)).toHaveLength(0)
      expect(await repos.pushSubscriptions.listByUser(two.id)).toHaveLength(1)
    })

    test('keeps at most ten subscriptions per user, evicting the oldest', async () => {
      const user = await repos.users.create({ username: 'push-cap', passwordHash: 'x', role: 'member' })
      for (let i = 0; i < 11; i += 1) {
        await repos.pushSubscriptions.upsertForUser(user.id, {
          endpoint: `https://e/cap-${i}`,
          p256dh: 'k',
          auth: 'a',
        })
      }
      const list = await repos.pushSubscriptions.listByUser(user.id)
      expect(list).toHaveLength(10)
      // The newest survives; tie-breaking on same-microsecond timestamps is not pinned.
      expect(list.some((row) => row.endpoint === 'https://e/cap-10')).toBe(true)
    })

    test('deleteByEndpoint only deletes the given user’s row', async () => {
      const owner = await repos.users.create({ username: 'push-del1', passwordHash: 'x', role: 'member' })
      const other = await repos.users.create({ username: 'push-del2', passwordHash: 'x', role: 'member' })
      await repos.pushSubscriptions.upsertForUser(owner.id, { endpoint: 'https://e/d', p256dh: 'k', auth: 'a' })
      await repos.pushSubscriptions.upsertForUser(other.id, { endpoint: 'https://e/d2', p256dh: 'k', auth: 'a' })

      await repos.pushSubscriptions.deleteByEndpoint(owner.id, 'https://e/d2')
      expect(await repos.pushSubscriptions.listByUser(owner.id)).toHaveLength(1)
      await repos.pushSubscriptions.deleteByEndpoint(owner.id, 'https://e/d')
      expect(await repos.pushSubscriptions.listByUser(owner.id)).toHaveLength(0)
      expect(await repos.pushSubscriptions.listByUser(other.id)).toHaveLength(1)
    })

    test('push settings round-trip', async () => {
      expect(await repos.pushSettings.get()).toBeNull()
      await repos.pushSettings.set({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.c' })
      expect(await repos.pushSettings.get()).toEqual({
        publicKey: 'pub',
        privateKey: 'priv',
        subject: 'mailto:a@b.c',
      })
      await repos.pushSettings.set({ publicKey: 'pub2', privateKey: 'priv2', subject: 'mailto:a@b.c' })
      expect((await repos.pushSettings.get())?.publicKey).toBe('pub2')
    })
  })
}

suite('postgres', () => createUserRepositories(ctx.db))
suite('memory', () => createMemoryUserRepositories())
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `bun test src/db/__tests__/push-repositories.test.ts`
Expected: FAIL — `repos.pushSubscriptions` is undefined / module not found.

- [ ] **Step 5: Implement the repositories**

`push-subscriptions.ts`: Postgres half uses
`db.insert(pushSubscriptions).values({...}).onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh, auth, userAgent, updatedAt: new Date() } }).returning()`;
then `listByUser` ordered `desc(createdAt), desc(id)`; if more than 10 rows, delete the excess oldest ids. `deleteById` by id; `deleteByEndpoint` with `and(eq(userId), eq(endpoint))`.
Memory half: `Map<id, record>` plus `idByEndpoint` index; clone on read like `api-keys.ts`; enforce the same cap and reassignment semantics.
Export `MAX_SUBSCRIPTIONS_PER_USER = 10` for tests/messages if needed.

`push-settings.ts`: single row `id: 'default'`; `get` returns `{ publicKey, privateKey, subject }` or null; `set` upserts with `updatedAt`.

Wire both into `types.ts` (`Repositories` + exported interfaces), `index.ts` (`createRepositories`, `createMemoryRepositories`, and re-export the two factories + `CreatePushSubscriptionInput`).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test src/db/__tests__/push-repositories.test.ts`
Expected: PASS (10 tests across two suites).

- [ ] **Step 7: Commit**

```bash
git add src/db src/contracts.ts
git commit -m "feat(rcs): add push subscription and VAPID storage"
```

---

### Task 2: VAPID config and pure notification helpers

**Files:**

- Modify: `src/config.ts`
- Create: `src/lib/push-payload.ts` (runtime-neutral pure helpers; the service worker will import only its types)
- Test: `src/lib/__tests__/push-payload.test.ts`

**Interfaces:**

- Produces (from `src/config.ts`, `GatewayConfig`): `vapidPublicKey: string | null`, `vapidPrivateKey: string | null`, `vapidSubject: string` (default `'mailto:noreply@localhost'`, from `RCS_VAPID_SUBJECT`).
- Produces (from `src/lib/push-payload.ts`):

  ```ts
  export type PushNotificationKind = 'permission' | 'question' | 'plan'
  export interface PushNotificationPayload {
    v: 1
    kind: PushNotificationKind
    sessionId: string
    sessionTitle?: string
    toolName: string
    description?: string
    requestId: string
  }
  export function isConfirmationRequest(type: string, payload: unknown): boolean
  export function buildNotificationPayload(
    session: { id: string; title: string | null },
    type: string,
    payload: unknown,
  ): PushNotificationPayload | null
  export function shouldNotifyOnce(seen: Map<string, number>, key: string, now: number, windowMs?: number): boolean
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/push-payload.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'

import { loadConfig } from '../../config.js'
import { buildNotificationPayload, isConfirmationRequest, shouldNotifyOnce } from '../push-payload.js'

const nested = {
  request_id: 'req-1',
  request: { subtype: 'can_use_tool', tool_name: 'Bash', description: 'Run tests', input: { command: 'bun test' } },
}

describe('isConfirmationRequest', () => {
  test('accepts a nested can_use_tool control request', () => {
    expect(isConfirmationRequest('control_request', nested)).toBe(true)
  })

  test('accepts the flat shape', () => {
    expect(isConfirmationRequest('control_request', { ...nested.request, request_id: 'req-1' })).toBe(true)
  })

  test('rejects other subtypes, event types, and junk', () => {
    expect(isConfirmationRequest('control_request', { request: { subtype: 'set_model' } })).toBe(false)
    expect(isConfirmationRequest('permission_response', nested)).toBe(false)
    expect(isConfirmationRequest('control_request', null)).toBe(false)
  })
})

describe('buildNotificationPayload', () => {
  test('maps permission requests', () => {
    expect(buildNotificationPayload({ id: 's1', title: 'Fix tests' }, 'control_request', nested)).toEqual({
      v: 1,
      kind: 'permission',
      sessionId: 's1',
      sessionTitle: 'Fix tests',
      toolName: 'Bash',
      description: 'Run tests',
      requestId: 'req-1',
    })
  })

  test('maps AskUserQuestion and ExitPlanMode kinds', () => {
    const kindOf = (tool: string) =>
      buildNotificationPayload({ id: 's1', title: null }, 'control_request', {
        request_id: 'r',
        request: { subtype: 'can_use_tool', tool_name: tool },
      })?.kind
    expect(kindOf('AskUserQuestion')).toBe('question')
    expect(kindOf('ExitPlanMode')).toBe('plan')
    expect(kindOf('Edit')).toBe('permission')
  })

  test('returns null without a request id or when not a confirmation', () => {
    expect(
      buildNotificationPayload({ id: 's1', title: null }, 'control_request', { request: { subtype: 'can_use_tool' } }),
    ).toBeNull()
    expect(buildNotificationPayload({ id: 's1', title: null }, 'user', nested)).toBeNull()
  })
})

describe('shouldNotifyOnce', () => {
  test('suppresses repeats inside the window and allows them after it', () => {
    const seen = new Map<string, number>()
    expect(shouldNotifyOnce(seen, 's1:req-1', 1_000)).toBe(true)
    expect(shouldNotifyOnce(seen, 's1:req-1', 2_000)).toBe(false)
    expect(shouldNotifyOnce(seen, 's1:req-1', 70_000)).toBe(true)
  })
})

describe('loadConfig VAPID fields', () => {
  test('reads the pair and defaults the subject', () => {
    const config = loadConfig({
      RCS_AUTH_SECRET: 'x',
      RCS_VAPID_PUBLIC_KEY: 'pub',
      RCS_VAPID_PRIVATE_KEY: 'priv',
    } as NodeJS.ProcessEnv)
    expect(config.vapidPublicKey).toBe('pub')
    expect(config.vapidPrivateKey).toBe('priv')
    expect(config.vapidSubject).toBe('mailto:noreply@localhost')
  })

  test('treats missing or empty values as null', () => {
    const config = loadConfig({ RCS_AUTH_SECRET: 'x', RCS_VAPID_PUBLIC_KEY: '  ' } as NodeJS.ProcessEnv)
    expect(config.vapidPublicKey).toBeNull()
    expect(config.vapidPrivateKey).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/lib/__tests__/push-payload.test.ts`
Expected: FAIL — `Cannot find module '../push-payload.js'` and missing config fields.

- [ ] **Step 3: Implement the config fields**

In `src/config.ts`, add the three fields to `GatewayConfig` and return them from `loadConfig`: trim env values, empty → `null`; subject defaults to `'mailto:noreply@localhost'`.

- [ ] **Step 4: Implement the pure helpers**

In `src/lib/push-payload.ts`:

```ts
function asRecord(value: unknown): Record<string, unknown> | null
```

- `isConfirmationRequest(type, payload)`: `type === 'control_request'` and
  `(record.request ?? record).subtype === 'can_use_tool'` (mirror `session-reducer.ts`).
- `buildNotificationPayload`: run the same check; read `request_id` from the top level
  (fall back to `(record.request ?? record).request_id`), `tool_name`, `description` from
  the request record; return `null` if any of `request_id`/`tool_name` is missing.
  `kind`: `AskUserQuestion` → `question`, `ExitPlanMode` → `plan`, else `permission`.
  Set `sessionTitle` only when `session.title` is non-empty.
- `shouldNotifyOnce`: prune entries older than `windowMs` (default `60_000`), return
  `false` if `key` is present, else store `now` and return `true`.

- [ ] **Step 5: Run to verify pass**

Run: `bun test src/lib/__tests__/push-payload.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/lib/push-payload.ts src/lib/__tests__/push-payload.test.ts
git commit -m "feat(rcs): add VAPID config and push payload helpers"
```

---

### Task 3: The notifier service

**Files:**

- Create: `src/services/push-notifier.ts`
- Test: `src/services/__tests__/push-notifier-service.test.ts`

**Interfaces:**

- Consumes: Task 1 repositories (`repos.pushSubscriptions`, `repos.pushSettings`, `repos.sessions`), Task 2 helpers from `src/lib/push-payload.ts`, `GatewayConfig` VAPID fields.
- Produces:

  ```ts
  export interface PushNotifierProvider {
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void
    generateVapidKeys(): { publicKey: string; privateKey: string }
    sendNotification(
      subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
      payload: string,
      options: { TTL: number; timeout: number },
    ): Promise<void>
  }
  export interface InitPushNotifierOptions {
    config: GatewayConfig
    repos: Repositories
    /** Test seam; defaults to a lazily imported `web-push`. */
    provider?: PushNotifierProvider
  }
  export async function initPushNotifier(options: InitPushNotifierOptions): Promise<void>
  export function resetPushNotifierForTests(): void
  export function getPushPublicConfig(): { enabled: boolean; publicKey: string | null }
  /** Fire-and-forget; never throws. No-op until init resolves or when push is disabled. */
  export function notifyInboundEvent(sessionId: string, type: string, payload: unknown): void
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/services/__tests__/push-notifier-service.test.ts`. Use `createMemoryRepositories()`, a fake provider recording calls, and fixed VAPID config:

```ts
import { beforeEach, describe, expect, test } from 'bun:test'

import { loadConfig } from '../../config.js'
import { createMemoryRepositories } from '../../db/repositories/index.js'
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
  } as NodeJS.ProcessEnv)
}

beforeEach(() => resetPushNotifierForTests())
```

Tests (all wait a tick after `notifyInboundEvent` — it is fire-and-forget; use a helper
`const flush = () => new Promise((resolve) => setTimeout(resolve, 0))`):

1. **uninitialized no-op**: `notifyInboundEvent(...)`; flush; fake provider `sent` empty.
2. **sends to every subscription of the owner with the right payload**: seed user/session + two subscriptions; init; notify; flush; `sent` has both endpoints and `payload.sessionId === session.id`, `payload.toolName === 'Bash'`, `payload.kind === 'permission'`.
3. **ignores sessions without an owner**: session with `ownerUserId: null`; no sends.
4. **ignores non-confirmation events**: `notifyInboundEvent(session.id, 'user', {...})`; no sends.
5. **drops a 410 subscription and keeps sending to the rest**: first call throws `Object.assign(new Error('gone'), { statusCode: 410 })` for endpoint A; flush; `listByUser` no longer contains A, and endpoint B received the push.
6. **dedupes the same request id**: call `notifyInboundEvent` twice with identical args; flush; exactly one send.
7. **uses stored VAPID keys when env is absent**: config with no VAPID vars; `repos.pushSettings.set({...})`; init; `getPushPublicConfig()` → `{ enabled: true, publicKey: 'stored' }`; `setVapidDetails` received `'stored'`.
8. **generates and persists keys when neither exists**: no env, no row; init; `pushSettings.get()` returns the generated pair; config enabled.
9. **disabled when only one env key is set and no stored row**: config with only `RCS_VAPID_PUBLIC_KEY`; init; `getPushPublicConfig()` → `{ enabled: false, publicKey: null }`; notify sends nothing.

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/services/__tests__/push-notifier-service.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement init, VAPID resolution, and send loop**

Module state: `let state: { enabled: boolean; publicKey: string | null; repos; provider; ready: Promise<void> } | null`.
`initPushNotifier`:

- Resolve keys: both env values present → use them (`subject` from config); else
  `repos.pushSettings.get()`; else `provider.generateVapidKeys()` + `repos.pushSettings.set(...)`.
- On any failure: `log('[RCS] push notifications disabled: …')`, set `enabled: false`,
  resolve ready.
- Call `provider.setVapidDetails(subject, publicKey, privateKey)`.
- Default provider: `const mod = await import('web-push'); const webpush = mod.default ?? mod;` map `sendNotification(sub, payload, { TTL: 3600, timeout: 5000 })`.

`notifyInboundEvent`: if no state → return; capture state; `void state.ready.then(() => run(state, args)).catch(() => {})`.
`run`: `isConfirmationRequest` guard → `repos.sessions.getById(sessionId)` → owner null → return;
`buildNotificationPayload` → null → return; dedupe via module `Map` using
`shouldNotifyOnce(seen, \`${sessionId}:${requestId}\`, Date.now())`; `repos.pushSubscriptions.listByUser(ownerId)`;
`Promise.allSettled`sending`JSON.stringify(payload)`; on rejection with
`statusCode === 404 || statusCode === 410`→`repos.pushSubscriptions.deleteById(id)`; log others.
`getPushPublicConfig`returns the enabled/publicKey slice.`resetPushNotifierForTests` clears state and the dedupe map.

- [ ] **Step 4: Run to verify pass**

Run: `bun test src/services/__tests__/push-notifier-service.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/push-notifier.ts src/services/__tests__/push-notifier-service.test.ts
git commit -m "feat(rcs): send web push when a session awaits confirmation"
```

---

### Task 4: Wire the notifier into ingress and gateway startup

**Files:**

- Modify: `src/transport/event-bus.ts` (after the record is persisted and published)
- Modify: `server/index.ts` (init next to `startDisconnectMonitor`)
- Test: `src/transport/__tests__/event-bus-notify.test.ts`

**Interfaces:**

- Consumes: `notifyInboundEvent` from Task 3; `initPushNotifier` from Task 3.

- [ ] **Step 1: Write the failing test**

Create `src/transport/__tests__/event-bus-notify.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test'

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
    } as NodeJS.ProcessEnv),
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
    } as NodeJS.ProcessEnv),
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
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/transport/__tests__/event-bus-notify.test.ts`
Expected: FAIL — `sent` is empty (no hook yet).

- [ ] **Step 3: Hook the funnel**

In `publishInboundEvent`, after `eventBus?.publish(event)` and before `return event`, add
`void notifyInboundEvent(sessionId, type, normalized)` (import from `../services/push-notifier.js`).
Do not await it. No other call site changes.

- [ ] **Step 4: Initialize in the gateway entry**

In `server/index.ts`, import `initPushNotifier` and call
`await initPushNotifier({ config, repos })` after `createRepositories` and before exporting the
server config. It never throws; a disabled result just logs.

- [ ] **Step 5: Run tests and the gateway build**

Run: `bun test src/transport/__tests__/event-bus-notify.test.ts`
Expected: PASS.
Run: `bun run build:gateway`
Expected: `dist/gateway.js` builds with no resolution errors. (If `web-push` breaks the bundle, switch the default provider to a dynamic `import('web-push')` — already the intended shape — and rebuild.)

- [ ] **Step 6: Commit**

```bash
git add src/transport/event-bus.ts server/index.ts src/transport/__tests__/event-bus-notify.test.ts
git commit -m "feat(rcs): notify on inbound confirmation requests"
```

---

### Task 5: Gateway push routes

**Files:**

- Create: `src/routes/web/push.ts`
- Modify: `src/gateway.ts` (mount the router on `/web`)
- Test: `src/routes/__tests__/push-routes.test.ts`

**Interfaces:**

- Consumes: `getPushPublicConfig` (Task 3), `repos.pushSubscriptions` (Task 1), `legacyUserAuth` / `readJson` (`src/routes/common.ts`).
- Produces over HTTP:
  - `GET /web/push/config` → `{ enabled: boolean, publicKey: string | null }`
  - `POST /web/push/subscriptions` body `{ endpoint: string, keys: { p256dh: string, auth: string } }` → 204
  - `DELETE /web/push/subscriptions?endpoint=…` → 204 (accepts `endpoint` decoded by Hono; 400 when missing)

- [ ] **Step 1: Write the failing route tests**

Create `src/routes/__tests__/push-routes.test.ts`, following `routes.test.ts` seeding (memory repos, `signAccessToken`, `Authorization: Bearer`):

1. `GET /web/push/config` without a token → 401.
2. After `initPushNotifier` with env VAPID keys → `GET` returns `{ enabled: true, publicKey: 'pub' }`.
3. Without init (call `resetPushNotifierForTests()` first) → `{ enabled: false, publicKey: null }`.
4. `POST /web/push/subscriptions` with a valid body → 204 and the row is stored for the caller.
5. `POST` with a missing `keys.auth` → 400 with `{ error, code }`.
6. `DELETE /web/push/subscriptions?endpoint=<encoded>` → 204 and removes only the caller's row; another user's identical endpoint remains.
7. `DELETE` without `endpoint` → 400.

Use `encodeURIComponent('https://push.example/e?x=1')` in the DELETE test to pin decoding.

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/routes/__tests__/push-routes.test.ts`
Expected: FAIL — 404 (router not mounted).

- [ ] **Step 3: Implement the routes**

`src/routes/web/push.ts` — `new Hono<AppEnv>()`, all three with `legacyUserAuth`:

- `GET /push/config` → `c.json(getPushPublicConfig(), 200)`.
- `POST /push/subscriptions` → `readJson`; require non-empty string `endpoint` and `keys.p256dh`
  / `keys.auth`; otherwise `c.json({ error: 'invalid subscription', code: 'invalid_subscription' }, 400)`.
  `await repos.pushSubscriptions.upsertForUser(c.get('user').id, { endpoint, p256dh, auth, userAgent: c.req.header('user-agent') ?? null })`;
  `c.body(null, 204)`.
- `DELETE /push/subscriptions` → `endpoint = c.req.query('endpoint')`; missing → 400
  `{ error: 'endpoint is required', code: 'endpoint_required' }`; `deleteByEndpoint(userId, endpoint)`; 204.

Mount in `src/gateway.ts`: `import webPush from './routes/web/push.js'` and `app.route('/web', webPush)` with the other web routes. CORS already covers `/web/*`.

- [ ] **Step 4: Run to verify pass**

Run: `bun test src/routes/__tests__/push-routes.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/web/push.ts src/gateway.ts src/routes/__tests__/push-routes.test.ts
git commit -m "feat(rcs): add web push subscription endpoints"
```

---

### Task 6: Service worker handlers and notification content

**Files:**

- Create: `src/lib/notification-content.ts`
- Test: `src/lib/__tests__/notification-content.test.ts`
- Modify: `src/app/sw.ts`
- Modify: `messages/en.json`, `messages/zh-CN.json` (add the `notifications` namespace)

**Interfaces:**

- Consumes: `PushNotificationPayload` type from `src/lib/push-payload.ts` (Task 2), `CATALOGS` (`src/i18n/catalogs.ts`). Import the type only — do not import `src/services/push-notifier.ts` from the service worker, or server code lands in the worker bundle.
- Produces:

  ```ts
  export interface NotificationContent {
    title: string
    body: string
    tag: string
    url: string
  }
  export function parseNotificationPayload(value: unknown): PushNotificationPayload | null
  export function toNotificationContent(payload: PushNotificationPayload, locale: 'en' | 'zh-CN'): NotificationContent
  export function shouldShowNotification(visiblePaths: string[], sessionId: string): boolean
  export const MAX_TITLE_LENGTH: number
  ```

- [ ] **Step 1: Add catalog keys**

Add to both catalogs, identical key sets and placeholders:

```json
"notifications": {
  "title": "Claude needs your confirmation",
  "permission": "Permission needed: {tool}",
  "question": "Claude has a question for you",
  "plan": "Claude has a plan ready for review"
}
```

zh-CN: `"title": "Claude 需要你确认"`, `"permission": "需要允许：{tool}"`,
`"question": "Claude 有问题需要你回答"`, `"plan": "Claude 的计划等待你确认"`.
(`catalogs.test.ts` enforces parity.)

- [ ] **Step 2: Write the failing helper tests**

Create `src/lib/__tests__/notification-content.test.ts`:

1. `parseNotificationPayload` accepts a valid payload and rejects missing `sessionId`/`requestId`/unknown `kind`.
2. `toNotificationContent(payload, 'en')` → title is the session title; body interpolates the tool name; `tag === 'session:s1:req-1'`; `url === '/s1'`.
3. Without a session title → title is the localized fallback (assert `'Claude needs your confirmation'` for en, `'Claude 需要你确认'` for zh-CN).
4. A 200-character session title is truncated to `MAX_TITLE_LENGTH` plus `…`; the result length is `MAX_TITLE_LENGTH + 1`.
5. `question` and `plan` bodies differ from `permission` and contain no `{tool}` placeholder leak.
6. `shouldShowNotification(['/s1'], 's1')` → false; `(['/s2'], 's1')` → true; `([], 's1')` → true.

- [ ] **Step 3: Run to verify failure**

Run: `bun test src/lib/__tests__/notification-content.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the helpers**

`notification-content.ts` imports `CATALOGS` and `type PushNotificationPayload` from
`./push-payload.js` (type-only). `MAX_TITLE_LENGTH = 60`.
`toNotificationContent`: `const copy = CATALOGS[locale].notifications`; title =
truncated `sessionTitle` or `copy.title`; body = `copy[payload.kind].replace('{tool}', payload.toolName)`
(no `{tool}` in question/plan copy); tag/url as specified.
`shouldShowNotification`: true when no visible path equals `/${sessionId}`.
`parseNotificationPayload`: structural validation of `v === 1`, string fields, kind in the union.

- [ ] **Step 5: Run to verify pass**

Run: `bun test src/lib/__tests__/notification-content.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the service worker handlers**

In `src/app/sw.ts`, widen the existing `declare const self` block:

```ts
declare const self: {
  __SW_MANIFEST: (PrecacheEntry | string)[]
  addEventListener(type: 'push' | 'notificationclick', listener: (event: Event) => void): void
  registration: { showNotification(title: string, options: Record<string, unknown>): Promise<void> }
  clients: {
    matchAll(options: {
      type: 'window'
      includeUncontrolled: boolean
    }): Promise<Array<{ url: string; visibilityState: string; focus(): Promise<unknown> }>>
    openWindow(url: string): Promise<unknown>
  }
  navigator: { language: string }
}
```

Add, after `serwist.addEventListeners()`:

- `push`: read `event.data`; wrap `json()` in try/catch and return on failure; run
  `parseNotificationPayload` (null → return); `waitUntil` an async handler that lists
  clients, computes visible paths whose `visibilityState === 'visible'`, returns early when
  `!shouldShowNotification(paths, sessionId)`, then
  `self.registration.showNotification(content.title, { body, tag, icon: '/icons/icon-192.png', data: { url } })`.
  Locale: `self.navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'`.
- `notificationclick`: `event.notification.close()`; read `data.url` (return when missing);
  `waitUntil` focusing a client whose path equals `data.url` (via `new URL(client.url).pathname`),
  else `self.clients.openWindow(url)`.
  Cast `event` to a small local shape (`{ data: { json(): unknown } | null; waitUntil(p: Promise<unknown>): void }`
  and `{ notification: { close(): void; data?: { url?: string } }; waitUntil(...): void }`).

- [ ] **Step 7: Verify production build compiles the worker**

Run: `bun run build`
Expected: build succeeds and produces `/serwist/sw.js` (Next build output). If the worker bundle cannot resolve the JSON catalog import, import the two JSON files from `../../../messages/` directly in `sw.ts` and pass them to a variant helper — do not inline copy in `sw.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/app/sw.ts src/lib/notification-content.ts src/lib/__tests__/notification-content.test.ts messages/en.json messages/zh-CN.json
git commit -m "feat(rcs): show web push notifications from the service worker"
```

---

### Task 7: Settings notifications card

**Files:**

- Create: `src/lib/push-subscription.ts`
- Test: `src/lib/__tests__/push-subscription.test.ts`
- Create: `src/components/settings/notifications.tsx`
- Modify: `src/app/(main)/settings/page.tsx` (render inside `SettingsApiProvider`)
- Modify: `messages/en.json`, `messages/zh-CN.json` (add `settings.notifications`)

**Interfaces:**

- Consumes: `useSettingsApi`, `createApiClient`, `getPushPublicConfig` shape via `GET /web/push/config`, `getApiBaseUrl`.
- Produces (from `src/lib/push-subscription.ts`):

  ```ts
  export type PushState = 'unsupported' | 'insecure' | 'ios-needs-install' | 'denied' | 'available'
  export interface PushEnvironment {
    secureContext: boolean
    hasServiceWorker: boolean
    hasPushManager: boolean
    hasNotification: boolean
    permission: NotificationPermission | 'default'
    isIos: boolean
    isStandalone: boolean
  }
  export function detectPushState(env: PushEnvironment): PushState
  export function urlBase64ToUint8Array(base64: string): Uint8Array
  export function subscriptionToRequest(subscription: {
    endpoint: string
    keys?: { p256dh?: string; auth?: string }
  }): { endpoint: string; keys: { p256dh: string; auth: string } } | null
  ```

- [ ] **Step 1: Write the failing helper tests**

Create `src/lib/__tests__/push-subscription.test.ts`:

1. Insecure context → `insecure` (even if every API exists).
2. Missing `PushManager` → `unsupported`.
3. iOS, not standalone → `ios-needs-install`.
4. Android/desktop, permission `'denied'` → `denied`.
5. All good → `available`.
6. `urlBase64ToUint8Array('AQID')` → `Uint8Array [1, 2, 3]`; it pads base64url correctly for `'_-8'`.
7. `subscriptionToRequest` returns trimmed values; returns `null` when `p256dh`/`auth` are missing.

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/lib/__tests__/push-subscription.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

`detectPushState` order: `!secureContext` → insecure; any missing API → unsupported;
`isIos && !isStandalone` → ios-needs-install; `permission === 'denied'` → denied; else available.
`urlBase64ToUint8Array`: pad with `=`, replace `-`/`_`, `atob`, map char codes.

- [ ] **Step 4: Run to verify pass**

Run: `bun test src/lib/__tests__/push-subscription.test.ts`
Expected: PASS.

- [ ] **Step 5: Add catalog copy**

Add `settings.notifications` to both catalogs with identical keys:
`title`, `description`, `enable`, `disable`, `enabling`, `enabled`, `disabled`,
`unavailable`, `insecure`, `iosInstall`, `denied`, `error`, `devHint`.
zh-CN text mirrors the English meaning (e.g. `"title": "通知"`, `"enable": "启用通知"`,
`"iosInstall": "将本应用添加到主屏幕后即可启用通知。"`).

- [ ] **Step 6: Build the card**

`src/components/settings/notifications.tsx` (`'use client'`):

- Compute the environment from `window.isSecureContext`, `navigator.serviceWorker`,
  `window.PushManager`, `window.Notification`, `Notification.permission`,
  iOS UA check (`/iphone|ipad|ipod/i`), and standalone check
  (`matchMedia('(display-mode: standalone)').matches || navigator.standalone`).
- State: `mode` (`detectPushState`), `subscribed` (boolean), `busy`, `error`.
- On mount with `mode === 'available'` and permission `'granted'`: await
  `navigator.serviceWorker.ready`, `pushManager.getSubscription()`; if present, `api.post`
  it (reconcile) and set `subscribed` true.
- Enable: `Notification.requestPermission()` (denied → set mode `denied`);
  `GET /web/push/config` → when `!enabled` show `unavailable` (dev hint when
  `process.env.NODE_ENV !== 'production'`); `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })`;
  `POST /web/push/subscriptions` with `subscriptionToRequest(sub)`.
- Disable: `sub.unsubscribe()`, then
  `api.delete(`/web/push/subscriptions?endpoint=${encodeURIComponent(sub.endpoint)}`)`.
- Render a `Card` matching `ApiKeys` styling: title/description, one Button, a status line
  for `insecure` / `ios-needs-install` / `denied` / `unavailable`, and errors through
  `useApiErrorMessage`. When `process.env.NODE_ENV !== 'production'` (the worker never
  registers under `next dev`), show the `devHint` status line and disable Enable.
- Wrap the body in a `<SettingsApiProvider>`-dependent token guard identical to `ApiKeys`
  (`token === null` → wait; `tokenError` → `errors.tokenUnavailable`).

In `settings/page.tsx`, render `<Notifications />` inside the existing
`<SettingsApiProvider>` next to `<ApiKeys />`.

- [ ] **Step 7: Typecheck and run the settings/i18n tests**

Run: `bun run typecheck`
Expected: PASS.
Run: `bun test src/lib/__tests__/push-subscription.test.ts src/i18n/__tests__/catalogs.test.ts src/__tests__/no-hardcoded-cjk.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/push-subscription.ts src/lib/__tests__/push-subscription.test.ts src/components/settings/notifications.tsx 'src/app/(main)/settings/page.tsx' messages/en.json messages/zh-CN.json
git commit -m "feat(rcs): add notification settings card"
```

---

### Task 8: Server dependency, docs, and full verification

**Files:**

- Modify: `package.json` (dependencies)
- Modify: `README.md` (deploy section)
- Modify: `docs/environment-variables.md`

- [ ] **Step 1: Add the dependency**

Run in `packages/rcs`: `bun add web-push && bun add -d @types/web-push`
Expected: `package.json` gains `web-push`; the root `bun.lock` updates.

- [ ] **Step 2: Verify the gateway bundle with the real package**

Run: `bun run build:gateway`
Expected: succeeds. Then run the gateway tests that import the notifier:
`bun test src/services src/transport/__tests__/event-bus-notify.test.ts`
Expected: PASS.

- [ ] **Step 3: Document the feature**

- `README.md` deploy section: one short subsection — "Push notifications": requires HTTPS
  (`RCS_DOMAIN`); iOS 16.4+ with the app added to the home screen; the gateway needs outbound
  access to the browser push services (FCM/Apple/Mozilla); VAPID keys are generated on first
  boot and stored in Postgres, overridable via env.
- `docs/environment-variables.md`: add `RCS_VAPID_PUBLIC_KEY`, `RCS_VAPID_PRIVATE_KEY`,
  `RCS_VAPID_SUBJECT` (optional; subject default `mailto:noreply@localhost`).

- [ ] **Step 4: Run the full required checks**

From the repo root:

- `bun run typecheck`
- `bun run fmt:check` (run `bun run fmt` to fix first)
- `bun run lint` — only failures in files this branch changed are actionable (pre-existing backlog stays).
- `cd packages/rcs && bun test` — all pass.

- [ ] **Step 5: Manual verification (needs a real HTTPS deployment)**

- Desktop Chrome: Settings → enable notifications, grant permission; close the tab; run a
  session that needs permission (default mode Bash) → notification appears; click → session opens.
- While the session is visible, trigger another confirmation → no OS notification.
- Phone (Android and/or iOS home-screen): same flow; iOS requires 16.4+ and the installed PWA.
- Revoke a subscription in DevTools (or delete the row) and confirm pushes are sent to the
  remaining devices.

- [ ] **Step 6: Commit**

```bash
git add package.json README.md ../../bun.lock ../../docs/environment-variables.md
git commit -m "docs(rcs): document web push notifications"
```
