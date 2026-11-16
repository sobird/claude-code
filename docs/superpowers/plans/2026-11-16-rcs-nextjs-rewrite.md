# @sobird/rcs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the new authoritative Remote Control Server in `packages/rcs`: a Next.js PWA UI plus a Bun/Hono gateway, backed by Postgres, with team accounts and durable session history.

**Architecture:** Next.js (Node) serves the UI at `/code` and owns Auth.js plus a short-lived access-token endpoint. A Bun gateway owns the existing bridge protocol routes (`/v1`, `/v2`, `/acp`, `/web`), WebSocket ingress, and SSE, sharing runtime-neutral services with Next. Postgres (Drizzle) is the source of truth; the in-memory event bus is a fan-out cache only.

**Tech Stack:** Next.js 16 App Router (React 19), Tailwind v4, Radix UI, Auth.js v5, Hono 4 on Bun 1.3.11, Drizzle ORM (postgres-js in production, PGlite in tests), `jose`, Serwist PWA.

**Spec:** `/Users/sobird/claude-code/docs/superpowers/specs/2026-11-16-rcs-nextjs-rewrite-design.md`

## Global Constraints

- Package name is `@sobird/rcs`, private, at `packages/rcs`; workspaces already include `packages/*`.
- Next runs on Node; the gateway runs on Bun 1.3.11. Files under `src/services`, `src/transport`, `src/routes`, `src/auth`, `src/db`, and `src/contracts.ts` must not import `Bun.*` or `hono/bun`.
- TypeScript strict via the root `tsconfig.json` (`bun run typecheck` covers `packages/rcs`). No `any` in production code; use `unknown` plus narrowing.
- Relative imports use the `.js` extension (maps to `.ts`/`.tsx`), per repo convention. Do not add a `@/` alias that root `tsc` cannot resolve.
- Formatting is oxfmt: no semicolons, single quotes, 2-space indent, 120 columns. Lint is oxlint; new code must add zero warnings. The old repo's Biome setup does not apply.
- Tests are `bun test`; database tests use PGlite and must not require Docker.
- UI is served under `basePath: '/code'`; CLI links `/code` and `/code/:sessionId` must keep working.
- Wire protocol is unchanged: keep every route and payload shape listed in the spec's compatibility table. Session IDs stay `cse_*` internally with the existing `session_*` web mapping.
- No auth token in URLs. HTTP uses `Authorization: Bearer`; WebSocket uses the `rcs.auth.<base64url>` subprotocol.
- Session events are write-through to Postgres; WS replay caps at `RCS_EVENT_REPLAY_LIMIT` (default 5000).
- `RCS_API_KEYS` is optional and legacy-only. `RCS_AUTH_SECRET` is required and signs access, environment, and worker tokens.
- Do not modify `/Users/sobird/Github/claude-code/packages/remote-control-server` or any other repository. Copy and adapt code only.
- v1 excludes Web Push, attachments, peer-session messages, event retention, session sharing, and multi-gateway fan-out.

## Review Focus

- Re-registration sending a stale or foreign `environment_id`: a caller must never reattach to another user's environment; mismatches create a fresh environment. Tested in Task 6 and Task 9.
- Two pollers on one environment at the same time: one work item must be delivered exactly once (atomic claim). Tested in Task 7.
- UI reconnect with `Last-Event-ID`: replay must be exclusive of the last seen ID and contain no duplicates or gaps. Tested in Task 7 and Task 14.
- Access token expiring while an SSE/WS stream is open: the UI must refresh, reconnect, and resume without losing events. Tested in Task 14.
- Concurrent claiming of an unowned legacy session: exactly one member wins; an admin viewing it must not claim it. Tested in Task 6.

---

### Task 1: Scaffold the package

**Files:**

- Create: `packages/rcs/package.json`
- Create: `packages/rcs/tsconfig.json`
- Create: `packages/rcs/next.config.ts`
- Create: `packages/rcs/postcss.config.mjs`
- Create: `packages/rcs/src/app/layout.tsx`, `packages/rcs/src/app/page.tsx`, `packages/rcs/src/app/globals.css`
- Create: `packages/rcs/scripts/dev.ts`
- Test: `packages/rcs/src/__tests__/package-shape.test.ts`

**Interfaces:**

- Produces: package scripts `dev`, `dev:web`, `dev:gateway`, `build`, `start`, `gateway`, `typecheck`, `test`, `db:generate`, `db:migrate`; Next config with `basePath: '/code'` and `output: 'standalone'`.

- [ ] **Step 1: Write the failing shape test**

```ts
import { expect, test } from 'bun:test'
import pkg from '../../package.json'

test('package name and scripts', () => {
  expect(pkg.name).toBe('@sobird/rcs')
  expect(pkg.private).toBe(true)
  expect(pkg.scripts.typecheck).toBe('tsc --noEmit')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/rcs && bun test src/__tests__/package-shape.test.ts`
Expected: FAIL — package.json not found.

- [ ] **Step 3: Create the package, configs, and a minimal page**

Create `package.json` with `"name": "@sobird/rcs"`, `"private": true`, `"type": "module"`, the scripts above, and dependencies: `next`, `react`, `react-dom`, `hono`, `jose`, `drizzle-orm`, `postgres`, `zod`, `next-auth`, `@serwist/next`, `serwist`, `tailwindcss`, `@tailwindcss/postcss`, plus the UI dependencies copied from `/Users/sobird/Github/claude-code/packages/remote-control-server/package.json` (Radix, `ai`, `@ai-sdk/react`, `shiki`, `streamdown`, `motion`, `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`, `cmdk`, `qrcode`, `jsqr`, `use-stick-to-bottom`, `react-resizable-panels`). Dev deps: `drizzle-kit`, `@electric-sql/pglite`, `@types/bun`, `@types/react`, `@types/react-dom`, `@types/qrcode`.

`tsconfig.json` extends `../../tsconfig.json` and adds `"jsx": "preserve"`, `"plugins": [{ "name": "next" }]`, and `"include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"]`.

`next.config.ts`: `basePath: '/code'`, `output: 'standalone'`, `reactStrictMode: true`, rewrites in development mapping `/v1/:path*`, `/v2/:path*`, `/acp/:path*`, `/web/:path*` to `http://localhost:4000/:path*`.

`scripts/dev.ts` spawns `next dev --port 3000` and `bun --watch server/index.ts`, prefixes output, and exits both on SIGINT.

- [ ] **Step 4: Verify**

Run: `cd packages/rcs && bun test src/__tests__/package-shape.test.ts`
Expected: PASS.
Run: `cd packages/rcs && bunx next build`
Expected: build succeeds and emits `.next/standalone`.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs
git commit -m "feat(rcs): scaffold Next.js and Bun gateway package"
```

---

### Task 2: Contracts and gateway config

**Files:**

- Create: `packages/rcs/src/contracts.ts`
- Create: `packages/rcs/src/config.ts`
- Test: `packages/rcs/src/__tests__/contracts.test.ts`

**Interfaces:**

- Produces: record types `UserRecord`, `ApiKeyRecord`, `EnvironmentRecord`, `SessionRecord`, `SessionWorkerRecord`, `WorkItemRecord`, `SessionEventRecord`; `Role = 'admin' | 'member'`; `toWebSessionId(id)`, `toCompatibleCodeSessionId(id)`, `isSessionClosedStatus(status)`; `GatewayConfig`; `loadConfig(env?: NodeJS.ProcessEnv): GatewayConfig`.
- `GatewayConfig` fields: `version`, `port`, `host`, `authSecret`, `baseUrl`, `apiKeys: string[]`, `pollTimeout`, `heartbeatInterval`, `jwtExpiresIn`, `envTokenTtl`, `disconnectTimeout`, `wsIdleTimeout`, `wsKeepaliveInterval`, `eventReplayLimit`, `webCorsOrigins: string[]`.

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from 'bun:test'
import { isSessionClosedStatus, toCompatibleCodeSessionId, toWebSessionId } from '../contracts.js'
import { loadConfig } from '../config.js'

test('session id mapping', () => {
  expect(toWebSessionId('cse_abc')).toBe('session_abc')
  expect(toCompatibleCodeSessionId('session_abc')).toBe('cse_abc')
  expect(toCompatibleCodeSessionId('cse_abc')).toBeNull()
})

test('closed statuses', () => {
  expect(isSessionClosedStatus('archived')).toBe(true)
  expect(isSessionClosedStatus('idle')).toBe(false)
  expect(isSessionClosedStatus(null)).toBe(false)
})

test('config defaults and required secret', () => {
  const cfg = loadConfig({ RCS_AUTH_SECRET: 'test-secret' } as NodeJS.ProcessEnv)
  expect(cfg.port).toBe(4000)
  expect(cfg.eventReplayLimit).toBe(5000)
  expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow('RCS_AUTH_SECRET')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rcs && bun test src/__tests__/contracts.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `contracts.ts` and `config.ts`**

Port the record shapes from `/Users/sobird/Github/claude-code/packages/remote-control-server/src/store.ts`, replacing `Date`-only fields with the same names in camelCase. Port ID mapping and closed-status logic from `.../src/services/session.ts` exactly. `loadConfig` reads the spec's environment variables, splits comma lists, and throws when `authSecret` is empty. Defaults: port `4000` (gateway; Next owns 3000), host `0.0.0.0`, poll `8`, heartbeat `20`, JWT `3600`, environment token `2592000`, disconnect `300`, WS idle `30`, keepalive `20`, replay limit `5000`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/rcs && bun test src/__tests__/contracts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/src/contracts.ts packages/rcs/src/config.ts packages/rcs/src/__tests__/contracts.test.ts
git commit -m "feat(rcs): add protocol contracts and gateway config"
```

---

### Task 3: Database schema, client factory, and migrations

**Files:**

- Create: `packages/rcs/src/db/schema.ts`
- Create: `packages/rcs/src/db/client.ts`
- Create: `packages/rcs/src/db/migrate.ts`
- Create: `packages/rcs/drizzle.config.ts`
- Create: `packages/rcs/src/db/migrations/` (generated SQL, committed)
- Test: `packages/rcs/src/db/__tests__/schema.test.ts`

**Interfaces:**

- Produces: `schema` (`users`, `apiKeys`, `environments`, `sessions`, `sessionWorkers`, `workItems`, `sessionEvents`); `Database` type; `createPostgresDatabase(url: string): Database`; `createPgliteDatabase(): Promise<{ db: Database; close(): Promise<void> }>`; `runMigrations(db: Database): Promise<void>`; `bootstrapSchema` used by tests.

- [ ] **Step 1: Write the failing test**

```ts
import { afterAll, expect, test } from 'bun:test'
import { createPgliteDatabase, runMigrations } from '../client.js'
import { users } from '../schema.js'

const ctx = await createPgliteDatabase()
await runMigrations(ctx.db)
afterAll(() => ctx.close())

test('users username is unique and lowercase-normalized by callers', async () => {
  const row = { id: crypto.randomUUID(), username: 'alice', passwordHash: 'x', role: 'member' as const }
  await ctx.db.insert(users).values(row)
  await expect(ctx.db.insert(users).values({ ...row, id: crypto.randomUUID() })).rejects.toThrow()
})

test('session events auto-increment ids', async () => {
  const rows = await ctx.db
    .insert(schema.sessionEvents)
    .values([
      { eventId: crypto.randomUUID(), sessionId: 'cse_x', type: 'user', payload: {}, direction: 'inbound' },
      { eventId: crypto.randomUUID(), sessionId: 'cse_x', type: 'assistant', payload: {}, direction: 'inbound' },
    ])
    .returning()
  expect(rows[1].id).toBeGreaterThan(rows[0].id)
})
```

(Import `schema` from `../schema.js` in the second test.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rcs && bun test src/db/__tests__/schema.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the schema and client**

Define the tables exactly as the spec's data model, using `text` IDs (`env_…`, `cse_…`, `work_…`), `uuid` for user/key IDs, `jsonb` for payloads, `timestamp with time zone`, and indexes on `(environment_id, state)`, `(owner_user_id, status)`, `session_events(session_id, id)`, and unique `users.username` and `api_keys.token_hash`. Use `bigserial` for `session_events.id`. `createPgliteDatabase` uses `drizzle-orm/pglite`; `createPostgresDatabase` uses `drizzle-orm/postgres-js`. `runMigrations` picks `drizzle-orm/pglite/migrator` or `drizzle-orm/postgres-js/migrator` based on the driver.

- [ ] **Step 4: Generate and run migrations**

Run: `cd packages/rcs && bunx drizzle-kit generate`
Run: `cd packages/rcs && bun test src/db/__tests__/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/src/db packages/rcs/drizzle.config.ts
git commit -m "feat(rcs): add Drizzle schema and Postgres/PGlite clients"
```

---

### Task 4: Tokens, password hashing, and API key helpers

**Files:**

- Create: `packages/rcs/src/auth/tokens.ts`
- Create: `packages/rcs/src/auth/password.ts`
- Create: `packages/rcs/src/auth/api-key.ts`
- Test: `packages/rcs/src/auth/__tests__/tokens.test.ts`
- Test: `packages/rcs/src/auth/__tests__/password.test.ts`

**Interfaces:**

- Produces:
  - `signAccessToken(user: { id: string; username: string; role: Role }, ttlSeconds?: number): Promise<string>`
  - `verifyAccessToken(token: string): Promise<{ sub: string; username: string; role: Role } | null>`
  - `signEnvironmentToken(environmentId: string, userId: string, ttlSeconds?: number): Promise<string>`
  - `verifyEnvironmentToken(token: string): Promise<{ environmentId: string; userId: string } | null>`
  - `signWorkerToken(sessionId: string, ttlSeconds?: number): Promise<string>`
  - `verifyWorkerToken(token: string): Promise<{ sessionId: string } | null>`
  - `hashPassword(password: string): Promise<string>`, `verifyPassword(password: string, encoded: string): Promise<boolean>`
  - `generateApiKey(): { raw: string; prefix: string; hash: string }`, `hashApiKey(raw: string): string`

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from 'bun:test'
import {
  signAccessToken,
  signEnvironmentToken,
  signWorkerToken,
  verifyAccessToken,
  verifyEnvironmentToken,
  verifyWorkerToken,
} from '../tokens.js'

process.env.RCS_AUTH_SECRET = 'test-secret'

test('access token round-trip and role', async () => {
  const token = await signAccessToken({ id: 'u1', username: 'alice', role: 'admin' }, 60)
  expect(await verifyAccessToken(token)).toEqual({ sub: 'u1', username: 'alice', role: 'admin' })
})

test('expired and tampered tokens are rejected', async () => {
  const short = await signAccessToken({ id: 'u1', username: 'alice', role: 'member' }, -1)
  expect(await verifyAccessToken(short)).toBeNull()
  expect(await verifyAccessToken('not-a-token')).toBeNull()
})

test('environment and worker tokens carry their ids', async () => {
  const env = await verifyEnvironmentToken(await signEnvironmentToken('env_1', 'u1'))
  expect(env).toEqual({ environmentId: 'env_1', userId: 'u1' })
  const worker = await verifyWorkerToken(await signWorkerToken('cse_1'))
  expect(worker).toEqual({ sessionId: 'cse_1' })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rcs && bun test src/auth/__tests__/tokens.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Use `jose` `SignJWT`/`jwtVerify` with HS256, `issuer: 'rcs'`, and an `aud` per token kind (`rcs-api`, `rcs-environment`, `rcs-worker`). Read the secret lazily from `process.env.RCS_AUTH_SECRET` so tests can set it. `password.ts` implements the spec's `scrypt$N=16384,r=8,p=1$salt$hash` format with `node:crypto` `scrypt` and `timingSafeEqual`; reject malformed encodings. `api-key.ts` generates `rcs_` + 32 random bytes base64url, returns the first 12 chars as prefix, and hashes with sha256 hex.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/rcs && bun test src/auth/__tests__`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/src/auth
git commit -m "feat(rcs): add signed tokens, scrypt passwords, and API keys"
```

---

### Task 5: Users and API-key repositories

**Files:**

- Create: `packages/rcs/src/db/repositories/types.ts`
- Create: `packages/rcs/src/db/repositories/users.ts`
- Create: `packages/rcs/src/db/repositories/api-keys.ts`
- Create: `packages/rcs/src/db/repositories/index.ts`
- Test: `packages/rcs/src/db/__tests__/users-repo.test.ts`

**Interfaces:**

- Produces: `UserRepository` with `create({ username, displayName?, passwordHash, role })`, `getById`, `getByUsername`, `count()`, `list()`, `setDisabled(id, disabledAt)`, `setPasswordHash(id, hash)`; `ApiKeyRepository` with `create({ userId, name, prefix, hash })`, `getByHash`, `touch(id)`, `revoke(id, at)`, `listByUser(userId)`; `createUserRepositories(db)` and `createMemoryUserRepositories()` returning both; `Repositories` starts as `{ users, apiKeys }` and is extended in later tasks.

- [ ] **Step 1: Write the failing tests (Postgres and memory halves)**

Create a PGlite database, run migrations, and build `repos` in `beforeEach` as in Task 3; run the same assertions against `createMemoryUserRepositories()` in a second `describe`.

```ts
test('create and look up a user by normalized username', async () => {
  const repos = createUserRepositories(ctx.db)
  const user = await repos.users.create({ username: 'alice', passwordHash: 'x', role: 'member' })
  expect((await repos.users.getByUsername('alice'))?.id).toBe(user.id)
  expect(await repos.users.getByUsername('ALICE')).toBeNull()
})

test('revoked API key lookup still resolves but reports revocation', async () => {
  const repos = createUserRepositories(ctx.db)
  const user = await repos.users.create({ username: 'bob', passwordHash: 'x', role: 'member' })
  const key = await repos.apiKeys.create({ userId: user.id, name: 'cli', prefix: 'rcs_abc', hash: 'h1' })
  await repos.apiKeys.revoke(key.id, new Date())
  const found = await repos.apiKeys.getByHash('h1')
  expect(found?.revokedAt).toBeInstanceOf(Date)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rcs && bun test src/db/__tests__/users-repo.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Postgres versions use Drizzle; memory versions use Maps and must produce the same `*Record` shapes from `contracts.ts`. Usernames are stored exactly as passed; callers normalize to lowercase. `api-keys` stores hashes only.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/rcs && bun test src/db/__tests__/users-repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/src/db/repositories packages/rcs/src/db/__tests__
git commit -m "feat(rcs): add user and API-key repositories"
```

---

### Task 6: Environment and session repositories

**Files:**

- Create: `packages/rcs/src/db/repositories/environments.ts`
- Create: `packages/rcs/src/db/repositories/sessions.ts`
- Modify: `packages/rcs/src/db/repositories/index.ts`
- Test: `packages/rcs/src/db/__tests__/environments-sessions-repo.test.ts`

**Interfaces:**

- Produces: `EnvironmentRepository`: `create(input)`, `getById(id)`, `update(id, patch)`, `listActive({ ownerUserId? })`, `findReusable({ environmentId, ownerUserId })`; `SessionRepository`: `create(input)`, `getById`, `listByOwner(userId)`, `listByEnvironment(envId)`, `listUnowned()`, `update(id, patch)`, `incrementEpoch(id)`, `claimUnowned(sessionId, userId): Promise<boolean>`, `archive(id, at)`; extend `Repositories` with `environments`, `sessions`.

- [ ] **Step 1: Write the failing tests, including the two Review Focus cases**

Use a freshly migrated PGlite database with all repositories from Tasks 5–7 (or the memory implementation) built in `beforeEach`. Create the users needed by each test first.

```ts
test('re-registration only reuses an environment owned by the caller', async () => {
  const owner = await repos.users.create({ username: 'owner', passwordHash: 'x', role: 'member' })
  const other = await repos.users.create({ username: 'other', passwordHash: 'x', role: 'member' })
  const env = await repos.environments.create({ ownerUserId: owner.id, workerType: 'claude_code', maxSessions: 1 })
  expect((await repos.environments.findReusable({ environmentId: env.id, ownerUserId: owner.id }))?.id).toBe(env.id)
  expect(await repos.environments.findReusable({ environmentId: env.id, ownerUserId: other.id })).toBeNull()
})

test('claimUnowned assigns exactly once', async () => {
  const a = await repos.users.create({ username: 'a', passwordHash: 'x', role: 'member' })
  const b = await repos.users.create({ username: 'b', passwordHash: 'x', role: 'member' })
  const session = await repos.sessions.create({ ownerUserId: null, source: 'remote-control', status: 'idle' })
  expect(await repos.sessions.claimUnowned(session.id, a.id)).toBe(true)
  expect(await repos.sessions.claimUnowned(session.id, b.id)).toBe(false)
  expect((await repos.sessions.getById(session.id))?.ownerUserId).toBe(a.id)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rcs && bun test src/db/__tests__/environments-sessions-repo.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`claimUnowned` is `UPDATE sessions SET owner_user_id = $1, updated_at = now() WHERE id = $2 AND owner_user_id IS NULL RETURNING id`; return whether a row came back. `findReusable` filters on `id`, `ownerUserId`, and `status = 'active'`. Session listing returns only non-archived rows unless asked otherwise. Keep `source` values from the old service (`web`, `acp`, `remote-control`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/rcs && bun test src/db/__tests__/environments-sessions-repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/src/db/repositories packages/rcs/src/db/__tests__
git commit -m "feat(rcs): add environment and session repositories"
```

---

### Task 7: Work, worker, and event repositories

**Files:**

- Create: `packages/rcs/src/db/repositories/work-items.ts`
- Create: `packages/rcs/src/db/repositories/session-workers.ts`
- Create: `packages/rcs/src/db/repositories/events.ts`
- Modify: `packages/rcs/src/db/repositories/index.ts`
- Test: `packages/rcs/src/db/__tests__/work-events-repo.test.ts`

**Interfaces:**

- Produces: `WorkItemRepository`: `enqueue({ environmentId, sessionId, secret })`, `claimNext(environmentId): Promise<WorkItemRecord | null>`, `getById`, `setState(id, state)`, `bump(id)`; `SessionWorkerRepository`: `get(sessionId)`, `upsert(sessionId, patch)`; `EventRepository`: `append(input): Promise<SessionEventRecord>`, `listSince(sessionId, afterId, limit)`, `listBefore(sessionId, beforeId, limit)`, `latestId(sessionId)`; extend `Repositories` with `workItems`, `sessionWorkers`, `events`; compose `createRepositories(db): Repositories` and `createMemoryRepositories(): Repositories`.

- [ ] **Step 1: Write the failing tests, including the two Review Focus cases**

Build `repos` against migrated PGlite in `beforeEach`; enqueue one work item for `env_1` before the concurrency test.

```ts
test('concurrent claims deliver an item once', async () => {
  const [a, b] = await Promise.all([repos.workItems.claimNext('env_1'), repos.workItems.claimNext('env_1')])
  const claimed = [a, b].filter(Boolean)
  expect(claimed).toHaveLength(1)
  expect(claimed[0]?.state).toBe('dispatched')
})

test('listSince is exclusive and ordered', async () => {
  const first = await repos.events.append({ sessionId: 'cse_1', type: 'user', payload: {}, direction: 'inbound' })
  const second = await repos.events.append({ sessionId: 'cse_1', type: 'assistant', payload: {}, direction: 'inbound' })
  const rows = await repos.events.listSince('cse_1', first.id, 100)
  expect(rows.map((r) => r.id)).toEqual([second.id])
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rcs && bun test src/db/__tests__/work-events-repo.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`claimNext` runs in a transaction: `SELECT … WHERE environment_id = $1 AND state = 'pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`, then `UPDATE … SET state = 'dispatched'`. `listSince` is `WHERE session_id = $1 AND id > $2 ORDER BY id LIMIT $3`. `listBefore` orders `id DESC` then reverses for display. `append` generates `eventId` with `crypto.randomUUID()` and returns the inserted row including its `bigserial` id.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/rcs && bun test src/db/__tests__/work-events-repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/src/db/repositories packages/rcs/src/db/__tests__
git commit -m "feat(rcs): add work, worker, and event repositories"
```

---

### Task 8: Gateway auth middleware

**Files:**

- Create: `packages/rcs/src/auth/context.ts`
- Create: `packages/rcs/src/auth/middleware.ts`
- Create: `packages/rcs/src/auth/cors.ts`
- Test: `packages/rcs/src/auth/__tests__/middleware.test.ts`

**Interfaces:**

- Consumes: `Repositories` from Tasks 5–7.
- Produces: `AppEnv` (`Variables`: `repos: Repositories`, `user`, `environment`, `workerSessionId`); `extractBearerToken(c)`, `extractWebSocketAuthToken(c)`, `encodeWebSocketAuthProtocol(token)`; `accessTokenAuth`, `apiKeyAuth`, `environmentAuth`, `sessionIngressAuth`, `requireAdmin` middlewares. `createGateway` injects `repos` with `app.use('*', (c, next) => { c.set('repos', repos); return next() })`.

- [ ] **Step 1: Write the failing matrix test**

Use a tiny Hono app with each middleware and fake repositories. Assert: valid access token sets `user`; invalid returns 401; valid API key sets the owning user; legacy key maps to the bootstrap admin; environment token with mismatched `:id` returns 403; worker token with mismatched session returns 403; `requireAdmin` rejects members.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rcs && bun test src/auth/__tests__/middleware.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Middleware order matters: access token → user API key → legacy key. `environmentAuth` accepts an environment token whose `environmentId` equals the route `:id`, an API key (owner or admin), and resolves `c.set('environment', record)`. `sessionIngressAuth` accepts an API key, a worker token whose `sessionId` equals the route id (or compatible `session_*`/`cse_*` mapping), or an environment token whose owner matches the session's environment owner. WebSocket tokens come from the header or `rcs.auth.*` subprotocol, never the query string. `cors.ts` exposes `webCorsOptions(origins)`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/rcs && bun test src/auth/__tests__/middleware.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/src/auth
git commit -m "feat(rcs): add account, environment, and worker auth middleware"
```

---

### Task 9: Gateway services

**Files:**

- Create: `packages/rcs/src/services/environment.ts`
- Create: `packages/rcs/src/services/session.ts`
- Create: `packages/rcs/src/services/work-dispatch.ts`
- Create: `packages/rcs/src/services/automationState.ts`
- Create: `packages/rcs/src/services/disconnect-monitor.ts`
- Create: `packages/rcs/src/services/transport.ts`
- Test: `packages/rcs/src/services/__tests__/*.test.ts` (port the matching old files)

**Interfaces:**

- Consumes: `Repositories` from Tasks 5–7.
- Produces: every exported service function takes `repos: Repositories` as its first argument. `registerEnvironment(repos, input)`, `deregisterEnvironment(repos, id)`, `reconnectEnvironment(repos, id)`, `updatePollTime(repos, id)`, `listActiveEnvironments(repos, { ownerUserId?, isAdmin })`; `createSession(repos, input)`, `createCodeSession(repos, input)`, `getSession(repos, id)`, `resolveExistingSessionId(repos, id)`, `resolveOwnedWebSessionId(repos, id, user)`, `listWebSessionsByOwner(repos, user)`, `updateSessionTitle/Status(repos, …)`, `archiveSession(repos, id)`, `incrementEpoch(repos, id)`; `createWorkItem(repos, environmentId, sessionId)`, `pollWork(repos, environmentId, timeoutSeconds)`, `ackWork`, `stopWork`, `heartbeatWork`, `reconnectWorkForEnvironment`; `startDisconnectMonitor({ repos, config })`, `stopDisconnectMonitor()`; `publishSessionEvent(repos, eventBus, sessionId, type, payload, direction)`.

- [ ] **Step 1: Port the old tests first**

Copy `src/__tests__/services.test.ts`, `work-dispatch.test.ts`, `automationState.test.ts`, and `disconnect-monitor.test.ts` from the old package, rewriting imports to the new modules and injecting `Repositories` instead of the global store. Keep every assertion that still applies; add tests that `registerEnvironment` returns a signed `environment_secret` accepted by `verifyEnvironmentToken`, that a work item's `session_ingress_token` verifies as a worker token for that session, and that re-registering with a foreign or stale `environment_id` creates a new environment instead of reusing it.

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/rcs && bun test src/services/__tests__`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Port behavior from `.../remote-control-server/src/services/*.ts`. Every store call becomes `repos.<x>`. `registerEnvironment` honors a reusable `environment_id` only through `repos.environments.findReusable`; otherwise creates a new record. The work secret keeps the old shape: `{ version: 1, session_ingress_token, api_base_url, sources, auth, use_code_sessions: false }`. Add a per-environment in-process notifier so `enqueue` wakes pollers immediately; `pollWork` claims once and then waits on the notifier with the configured timeout.

- [ ] **Step 4: Run to verify they pass**

Run: `cd packages/rcs && bun test src/services/__tests__`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/src/services
git commit -m "feat(rcs): port gateway services to async repositories"
```

---

### Task 10: Gateway HTTP routes

**Files:**

- Create: `packages/rcs/src/routes/v1/environments.ts`, `environments.work.ts`, `sessions.ts`
- Create: `packages/rcs/src/routes/v2/code-sessions.ts`, `worker.ts`, `worker-events.ts`, `worker-events-stream.ts`
- Create: `packages/rcs/src/routes/web/auth.ts`, `sessions.ts`, `control.ts`, `environments.ts`, `account.ts`, `admin.ts`
- Test: `packages/rcs/src/routes/__tests__/routes.test.ts` (port old `routes.test.ts`)

**Interfaces:**

- Consumes: Task 8 middlewares, Task 9 services, and `c.get('repos')` for data access.
- Produces route modules default-exporting `Hono<AppEnv>`; account routes: `POST /web/account/password`, `GET/POST /web/api-keys`, `DELETE /web/api-keys/:id`; admin routes: `GET/POST /web/admin/users`, `PATCH /web/admin/users/:id`.

- [ ] **Step 1: Port the old route tests**

Build a test Hono app that mounts the route modules and sets `repos` (memory repositories plus seeded users). Then copy `.../src/__tests__/routes.test.ts` and update auth setup: replace `?uuid=` with a Bearer access token, add ownership cases (member cannot read another member's session, admin can), and add cases for environment re-registration mismatch, member claiming an unowned session, and an admin reading an unowned session without claiming it. Add API-key CRUD and admin user tests.

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/rcs && bun test src/routes/__tests__/routes.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the routes**

Port each route from the old package, swapping `uuidAuth` for `accessTokenAuth` and adding ownership checks. `GET /web/sessions` and `/web/sessions/all` filter by `c.get('user')`; admins bypass the filter. `GET /web/environments` returns the caller's environments (admins all). `POST /web/sessions` dispatches work as before. Keep the v2 worker routes untouched in behavior. Account and admin routes enforce password re-hash, key revocation, and role changes; an admin cannot demote or disable the last admin.

- [ ] **Step 4: Run to verify they pass**

Run: `cd packages/rcs && bun test src/routes/__tests__/routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/src/routes
git commit -m "feat(rcs): port gateway HTTP routes with account ownership"
```

---

### Task 11: Gateway transport (WS, SSE, normalization)

**Files:**

- Create: `packages/rcs/src/transport/event-bus.ts`
- Create: `packages/rcs/src/transport/client-payload.ts`
- Create: `packages/rcs/src/transport/ws-payload.ts`
- Create: `packages/rcs/src/transport/ws-handler.ts`
- Create: `packages/rcs/src/transport/ws-shared.ts`
- Create: `packages/rcs/src/transport/sse-writer.ts`
- Create: `packages/rcs/src/routes/v1/session-ingress.ts`
- Test: `packages/rcs/src/transport/__tests__/*.test.ts` (port old WS/SSE/normalization tests)

**Interfaces:**

- Consumes: `Repositories`, `GatewayConfig`.
- Produces: `getEventBus(sessionId)`, `removeEventBus(sessionId)`; `handleWebSocketOpen(repos, config, ws, sessionId)`, `handleWebSocketMessage(repos, ws, sessionId, data)`, `handleWebSocketClose(ws, sessionId, code?, reason?)`; `ingestBridgeMessage(repos, sessionId, msg)` (awaits persistence before publishing); `createSSEStream(c, repos, sessionId, fromId)`; `createWorkerEventStream(c, repos, sessionId, fromId)`; session ingress route module.

- [ ] **Step 1: Port the old tests**

Copy `event-bus.test.ts`, `client-payload.test.ts`, `sse-writer.test.ts`, `ws-handler.test.ts`, and `transport-normalize.test.ts`. Replace in-memory replay expectations with repository-backed replay: WS open calls `repos.events.listSince(sessionId, 0, config.eventReplayLimit)`; SSE with `Last-Event-ID` calls `listSince` with the header value.

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/rcs && bun test src/transport/__tests__`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Port the old transport code verbatim where possible. Key changes: `EventBus.publish` no longer retains history; `ingestBridgeMessage` awaits `repos.events.append` then publishes the returned record (mapping `createdAt` to epoch ms). `toClientPayload` stays identical. Keep keepalive intervals and dead-client detection. `ws-shared.ts` re-exports `upgradeWebSocket` and `websocket` from `hono/bun`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/rcs && bun test src/transport/__tests__`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/src/transport packages/rcs/src/routes/v1/session-ingress.ts
git commit -m "feat(rcs): port WebSocket and SSE transport with durable replay"
```

---

### Task 12: ACP transport and routes

**Files:**

- Create: `packages/rcs/src/transport/acp-ws-handler.ts`
- Create: `packages/rcs/src/transport/acp-relay-handler.ts`
- Create: `packages/rcs/src/transport/acp-sse-writer.ts`
- Create: `packages/rcs/src/routes/acp/index.ts`
- Test: `packages/rcs/src/transport/__tests__/acp.test.ts`

**Interfaces:**

- Consumes: `Repositories` via `c.get('repos')` and the Task 8 auth middlewares.
- Produces: ACP routes at the same paths; agent listing filtered by owner (admins all); relay WS verifies ownership of `:agentId`; channel-group events remain in-memory.

- [ ] **Step 1: Write the failing tests**

Cover: API-key auth still works; access-token auth works; a member's `/acp/agents` excludes another member's agents; relay rejects a non-owner with 4003; channel-group SSE replays from the in-memory bus.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rcs && bun test src/transport/__tests__/acp.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Port the three transport files and the route module from the old package. Replace `storeListAcpAgents*` with repository queries on `worker_type = 'acp'` plus owner filtering. Keep `getAcpEventBus(channelGroupId)` as today; no DB persistence.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/rcs && bun test src/transport/__tests__/acp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/src/transport packages/rcs/src/routes/acp
git commit -m "feat(rcs): port ACP transport with owner-scoped access"
```

---

### Task 13: Gateway app factory and Bun entry

**Files:**

- Create: `packages/rcs/src/gateway.ts`
- Create: `packages/rcs/server/index.ts`
- Create: `packages/rcs/src/logger.ts`
- Test: `packages/rcs/src/__tests__/gateway.test.ts`

**Interfaces:**

- Produces: `createGateway({ config, repos }): Hono<AppEnv>` mounting `/health`, `/v1`, `/v2`, `/acp`, `/web`; `server/index.ts` loads config, connects Postgres, runs migrations, starts `Bun.serve` with the config's WS idle timeout, and closes connections on SIGINT/SIGTERM.

- [ ] **Step 1: Write the failing test**

```ts
test('health returns version and unauthenticated web routes 401', async () => {
  const app = createGateway({ config: testConfig, repos: createMemoryRepositories() })
  const health = await app.request('/health')
  expect(health.status).toBe(200)
  expect((await health.json()).status).toBe('ok')
  expect((await app.request('/web/sessions')).status).toBe(401)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rcs && bun test src/__tests__/gateway.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Wire the route modules exactly as the old `index.ts` did, minus static serving. Add CORS for `/web/*` from `webCorsOrigins`. `server/index.ts` throws if `DATABASE_URL` or `RCS_AUTH_SECRET` is missing, awaits `runMigrations`, logs the same startup lines as today, and exports the Bun config object.

- [ ] **Step 4: Verify**

Run: `cd packages/rcs && bun test src/__tests__/gateway.test.ts`
Expected: PASS.
Run: `cd packages/rcs && bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/src/gateway.ts packages/rcs/server packages/rcs/src/logger.ts
git commit -m "feat(rcs): add gateway app factory and Bun entrypoint"
```

---

### Task 14: Next.js auth, login, and access tokens

**Files:**

- Create: `packages/rcs/src/lib/auth.ts`
- Create: `packages/rcs/src/lib/access-token.ts`
- Create: `packages/rcs/src/lib/rate-limit.ts`
- Create: `packages/rcs/src/app/api/auth/[...nextauth]/route.ts`
- Create: `packages/rcs/src/app/api/access-token/route.ts`
- Create: `packages/rcs/src/app/login/page.tsx`
- Create: `packages/rcs/src/middleware.ts`
- Create: `packages/rcs/src/lib/bootstrap.ts`
- Test: `packages/rcs/src/lib/__tests__/access-token.test.ts`
- Test: `packages/rcs/src/lib/__tests__/rate-limit.test.ts`

**Interfaces:**

- Produces: Auth.js `handlers`, `auth()`, `signIn`, `signOut`; `createAccessTokenForSession(session): Promise<string>`; `createRateLimiter({ limit, windowMs })`; `ensureBootstrapAdmin(repos)`; middleware matching `/code/:path*` except login and Next internals.

- [ ] **Step 1: Write the failing tests**

```ts
test('access token carries the session user', async () => {
  const token = await createAccessTokenForSession({ user: { id: 'u1', name: 'alice', role: 'admin' } })
  expect(await verifyAccessToken(token)).toEqual({ sub: 'u1', username: 'alice', role: 'admin' })
})

test('rate limiter blocks the sixth attempt in a window', () => {
  const limiter = createRateLimiter({ limit: 5, windowMs: 1000 })
  for (let i = 0; i < 5; i++) expect(limiter.check('1.1.1.1:alice')).toBe(true)
  expect(limiter.check('1.1.1.1:alice')).toBe(false)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rcs && bun test src/lib/__tests__`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`lib/auth.ts`: Auth.js Credentials provider normalizing the username, `verifyPassword`, rejecting disabled users, JWT role claim, `secret: process.env.RCS_AUTH_SECRET`, `trustHost: true`. Because the app uses `basePath: '/code'`, confirm the Auth.js endpoints resolve at `/code/api/auth/*`; set `basePath: '/code/api/auth'` explicitly if the default `/api/auth` is used. `lib/access-token.ts` wraps `signAccessToken` with a 300-second TTL, maps `session.user.name` to `username`, reads the role from the JWT claim, and rejects sessions without an id. `rate-limit.ts` is an in-memory fixed-window map keyed by IP+username. `bootstrap.ts` creates the lowercase `ADMIN_USERNAME` with `ADMIN_PASSWORD` when `users.count() === 0`. The access-token route calls the limiter, requires a session, and returns `{ token, expiresIn: 300 }`. `middleware.ts` redirects unauthenticated page requests to `/code/login?next=…`.

- [ ] **Step 4: Verify**

Run: `cd packages/rcs && bun test src/lib/__tests__`
Expected: PASS.
Run: `cd packages/rcs && bunx next build`
Expected: build succeeds; `/code/login` and `/code/api/access-token` appear in the route list.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/src/lib packages/rcs/src/app/api packages/rcs/src/app/login packages/rcs/src/middleware.ts
git commit -m "feat(rcs): add Auth.js login and access-token issuance"
```

---

### Task 15: UI data layer (API, SSE, WS, reconnect)

**Files:**

- Create: `packages/rcs/src/lib/api-client.ts`
- Create: `packages/rcs/src/lib/sse-client.ts`
- Create: `packages/rcs/src/lib/ws-client.ts`
- Create: `packages/rcs/src/hooks/useAccessToken.ts`
- Create: `packages/rcs/src/hooks/useSessionStream.ts`
- Test: `packages/rcs/src/lib/__tests__/sse-client.test.ts`
- Test: `packages/rcs/src/lib/__tests__/reconnect.test.ts`

**Interfaces:**

- Produces: `getApiBaseUrl()`, `createApiClient({ getToken, refreshToken, baseUrl })` with `get/post/delete`; `consumeSse(response, onEvent, signal)`; `runStreamWithRefresh(deps)` (exported for testing: opens a stream, refreshes once on 401, resumes from the last event id, returns `{ reconnects, resumedFrom }`); `connectSessionSocket({ baseUrl, sessionId, token })`; `useAccessToken()` returning `{ token, refresh }`; `useSessionStream(sessionId)` with `{ events, status, error }` and automatic refresh-and-resume.

- [ ] **Step 1: Write the failing tests, including the Review Focus case**

```ts
test('consumeSse handles split chunks and multiple events', async () => {
  const chunks = ['id: 2\nevent:', ' message\ndata: {"a":1}\n\nid: 3\ndata: {', '"a":2}\n\n']
  const seen: Array<{ id?: string; data: string }> = []
  await consumeSse(
    new Response(
      new ReadableStream({
        start(c) {
          for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch))
          c.close()
        },
      }),
    ),
    (e) => seen.push(e),
  )
  expect(seen).toEqual([
    { id: '2', event: 'message', data: '{"a":1}' },
    { id: '3', event: undefined, data: '{"a":2}' },
  ])
})

test('401 during a stream triggers one refresh then resume from last id', async () => {
  const gate = createStreamGate()
  await expect(runStreamWithRefresh(gate.deps)).resolves.toMatchObject({ reconnects: 1, resumedFrom: '7' })
})
```

Factor the refresh/resume loop into an exported `runStreamWithRefresh` so it is testable without React.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rcs && bun test src/lib/__tests__`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`api-client` attaches `Authorization`, refreshes once on 401, and surfaces `{ error }` messages. `sse-client` buffers decoded text, splits on blank lines, parses `id`, `event`, and `data` fields, and ignores comments. `useSessionStream` holds the last event id, opens SSE via `fetch`, on 401 calls `refreshToken` and reconnects with `Last-Event-ID`, and caps retries with exponential backoff (1s, 2s, 4s, max 30s). WS connect uses the `rcs.auth.` subprotocol; the UI uses WS only for ACP relay, not for session history.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/rcs && bun test src/lib/__tests__`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/src/lib packages/rcs/src/hooks
git commit -m "feat(rcs): add token-aware API, SSE, and WS clients"
```

---

### Task 16: UI shell and dashboard

**Files:**

- Create: `packages/rcs/src/app/(app)/layout.tsx`
- Create: `packages/rcs/src/app/(app)/page.tsx`
- Create: `packages/rcs/src/components/shell/{navbar,session-list,environment-list,new-session-dialog}.tsx`
- Create: `packages/rcs/src/components/ui/*` (port Radix primitives from the old `web/components/ui`)
- Create: `packages/rcs/src/lib/theme.ts`
- Modify: `packages/rcs/src/app/globals.css` (design tokens, Tailwind v4)
- Test: `packages/rcs/src/components/__tests__/dashboard.test.ts` (pure selectors only)

**Interfaces:**

- Produces: authenticated `/code` dashboard; `selectVisibleSessions(sessions, user)` and `selectVisibleEnvironments(envs, user)` helpers used by the page.

- [ ] **Step 1: Write the failing selector test**

```ts
test('members see only their sessions; admins see all', () => {
  const sessions = [
    { id: 's1', owner: 'a' },
    { id: 's2', owner: 'b' },
  ]
  expect(selectVisibleSessions(sessions, { id: 'a', role: 'member' })).toHaveLength(1)
  expect(selectVisibleSessions(sessions, { id: 'x', role: 'admin' })).toHaveLength(2)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rcs && bun test src/components/__tests__/dashboard.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Port visual components and tokens from `/Users/sobird/Github/claude-code/packages/remote-control-server/web` (Tailwind classes, Radix wrappers, theme provider). The layout renders Navbar, session drawer, and connection badge. The dashboard fetches `/web/environments` and `/web/sessions/all` through `api-client`, shows an unclaimed-sessions section, and offers "new session". Use skeletons while loading and an empty state with the CLI setup hint (`CLAUDE_BRIDGE_BASE_URL`). Mobile: single column, drawer for sessions.

- [ ] **Step 4: Verify**

Run: `cd packages/rcs && bun test src/components/__tests__/dashboard.test.ts`
Run: `cd packages/rcs && bunx next build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/src/app packages/rcs/src/components packages/rcs/src/lib/theme.ts
git commit -m "feat(rcs): add authenticated app shell and dashboard"
```

---

### Task 17: Session detail UI

**Files:**

- Create: `packages/rcs/src/app/(app)/[sessionId]/page.tsx`
- Create: `packages/rcs/src/components/chat/{chat-view,message-bubble,tool-call-group,permission-panel,plan-view,chat-input}.tsx`
- Create: `packages/rcs/src/lib/session-reducer.ts`
- Test: `packages/rcs/src/lib/__tests__/session-reducer.test.ts`

**Interfaces:**

- Produces: `initialChatState`, `reduceSessionEvent(state, event)`, `applyHistory(state, events)`; the page loads history (`GET /web/sessions/:id/history`), then streams with `useSessionStream`, sends messages via `POST /web/sessions/:id/events`, approvals via `/control`, and interrupt via `/interrupt`.

- [ ] **Step 1: Write the failing reducer tests**

Cover: assistant text appends; tool_use creates a call; tool_result attaches output; control_request creates a pending permission; control_response resolves it; `session_status` archived marks closed; duplicate event IDs are ignored (replay safety).

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rcs && bun test src/lib/__tests__/session-reducer.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Port presentation components from the old `web/components/chat` and `web/components/ai-elements`, adapting data sources to the reducer. Keep permission cards thumb-friendly on mobile and the plan view as-is. The input disables when the session is archived and shows a reconnect banner when the stream is down.

- [ ] **Step 4: Verify**

Run: `cd packages/rcs && bun test src/lib/__tests__/session-reducer.test.ts`
Run: `cd packages/rcs && bunx next build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/src/app/\(app\)/\[sessionId\] packages/rcs/src/components/chat packages/rcs/src/lib/session-reducer.ts
git commit -m "feat(rcs): add session detail UI with live stream and approvals"
```

---

### Task 18: Settings and admin UI

**Files:**

- Create: `packages/rcs/src/app/(app)/settings/page.tsx`
- Create: `packages/rcs/src/app/(app)/admin/page.tsx`
- Create: `packages/rcs/src/components/settings/{api-keys,password-form,install-prompt}.tsx`
- Create: `packages/rcs/src/components/admin/user-table.tsx`
- Test: `packages/rcs/src/components/__tests__/settings.test.ts`

**Interfaces:**

- Produces: settings page calling `/web/account/password` and `/web/api-keys`; admin page calling `/web/admin/users`; both gated client-side and server-side by role.

- [ ] **Step 1: Write the failing test**

Test pure helpers: `maskApiKey(prefix)` renders `rcs_abcd…`; `validatePasswordChange({ current, next, confirm })` rejects short or mismatched values; `canManageUsers(user)` is true only for admins.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rcs && bun test src/components/__tests__/settings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Build the settings page (account, password, API keys list/create/revoke with the raw key shown once, install prompt) and the admin page (users table with create, disable, role change; last-admin protection surfaced). Reuse shell and UI primitives from Task 16.

- [ ] **Step 4: Verify**

Run: `cd packages/rcs && bun test src/components/__tests__/settings.test.ts`
Run: `cd packages/rcs && bunx next build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/src/app/\(app\)/settings packages/rcs/src/app/\(app\)/admin packages/rcs/src/components
git commit -m "feat(rcs): add settings and admin pages"
```

---

### Task 19: PWA

**Files:**

- Create: `packages/rcs/public/manifest.webmanifest`
- Create: `packages/rcs/public/icons/{icon-192.png,icon-512.png,icon-maskable-512.png}`
- Create: `packages/rcs/src/app/sw.ts`
- Modify: `packages/rcs/next.config.ts`
- Modify: `packages/rcs/src/app/layout.tsx` (metadata, manifest link, theme color)
- Test: `packages/rcs/src/__tests__/manifest.test.ts`

**Interfaces:**

- Produces: installable PWA scoped to `/code/`; service worker precaches the app shell and never caches `/web`, `/v1`, `/v2`, `/acp` responses.

- [ ] **Step 1: Write the failing test**

```ts
test('manifest is standalone and scoped to /code/', async () => {
  const manifest = await Bun.file(new URL('../../public/manifest.webmanifest', import.meta.url)).json()
  expect(manifest.display).toBe('standalone')
  expect(manifest.start_url).toBe('/code/')
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toContain('512x512')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rcs && bun test src/__tests__/manifest.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add `withSerwistInit({ swSrc: 'src/app/sw.ts', swDest: 'public/sw.js', additionalPrecacheEntries: [...] })` to `next.config.ts`, with runtime caching disabled for API paths and `globPublicExclude`. `sw.ts` calls `self.skipWaiting()` and `clientsClaim()`, uses `defaultCache` minus API routes, and precaches `/~offline` if present. Add icons and metadata. Wire the install prompt component from Task 18 to `beforeinstallprompt`.

- [ ] **Step 4: Verify**

Run: `cd packages/rcs && bun test src/__tests__/manifest.test.ts`
Run: `cd packages/rcs && bunx next build` and confirm `public/sw.js` is emitted.
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/public packages/rcs/src/app/sw.ts packages/rcs/next.config.ts packages/rcs/src/app/layout.tsx
git commit -m "feat(rcs): make the app installable as a PWA"
```

---

### Task 20: Docker, Caddy, docs, and smoke check

**Files:**

- Create: `packages/rcs/Dockerfile`
- Create: `packages/rcs/docker-compose.yml`
- Create: `packages/rcs/Caddyfile`
- Create: `packages/rcs/.dockerignore`
- Create: `packages/rcs/README.md`
- Create: `packages/rcs/.env.example`
- Create: `packages/rcs/scripts/smoke.ts`

**Interfaces:**

- Produces: one image running Next (`node .next/standalone/server.js`), the bundled gateway (`bun dist/gateway.js`), migrations (`bun dist/migrate.js`), plus compose services `postgres`, `app`, `gateway`, `caddy`.

- [ ] **Step 1: Write the failing smoke script test**

`scripts/smoke.ts` starts an in-process gateway with memory repositories on an ephemeral port, then asserts `/health` → 200, `POST /v1/environments/bridge` with a test API key → 200 and a verifiable environment token, and an unauthenticated `/web/sessions` → 401. It exits non-zero on failure.

Run it first: `cd packages/rcs && bun scripts/smoke.ts`
Expected: FAIL — gateway not yet wired for memory mode (or file missing).

- [ ] **Step 2: Implement the smoke script and Docker assets**

Make `scripts/smoke.ts` construct `createGateway({ config, repos: createMemoryRepositories() })`, seed an admin user (or call `ensureBootstrapAdmin`), and use `app.request`. In `Dockerfile`, use a Bun deps/build stage and a `node:22-bookworm-slim` runtime stage with the Bun binary copied for the gateway; bundle `server/index.ts` and `src/db/migrate.ts` with `bun build --target bun --outfile dist/…`. `docker-compose.yml` wires `DATABASE_URL`, `RCS_AUTH_SECRET`, `ADMIN_USERNAME/PASSWORD`, healthchecks, and volumes. `Caddyfile` routes `/v1/* /v2/* /acp/* /web/* /api/oauth/*` to `gateway:4000`, everything else to `app:3000`, with automatic HTTPS when `RCS_DOMAIN` is set. Write `.env.example` and README covering accounts, CLI env vars, ACP, and the manual end-to-end smoke.

- [ ] **Step 3: Run the smoke check**

Run: `cd packages/rcs && bun scripts/smoke.ts`
Expected: prints all checks and exits 0.

- [ ] **Step 4: Validate compose configuration**

Run: `cd packages/rcs && docker compose config`
Expected: valid config (requires Docker; if unavailable, record that it was skipped).

- [ ] **Step 5: Run repo gates**

Run: `cd /Users/sobird/claude-code && bun run typecheck && bun run lint && bun run fmt:check && bun test packages/rcs`
Expected: all pass with no new warnings.

- [ ] **Step 6: Commit**

```bash
git add packages/rcs
git commit -m "feat(rcs): add Docker deployment, docs, and smoke check"
```

---

## Self-Review Notes

- Spec coverage: architecture/process split (Tasks 1, 13, 20); accounts/roles/access tokens (Tasks 4, 5, 8, 14); per-user API keys and env/worker tokens (Tasks 4, 9, 10); Postgres schema and repositories (Tasks 3–7); durable events and replay (Tasks 7, 11, 15); WS/SSE/ACP (Tasks 11, 12); UI surface (Tasks 16–18); PWA (Task 19); deployment/TLS (Task 20); ownership and unclaimed sessions (Tasks 6, 10); rate limiting/disable semantics (Tasks 8, 14); lint/runtime constraints (Global Constraints, Task 20).
- Deferred by design: Web Push, attachments, peer messages, retention, sharing, multi-gateway fan-out.
- Interface names used consistently: `Repositories`, `createMemoryRepositories`, `verifyAccessToken`, `listSince`, `claimUnowned`, `consumeSse`, `reduceSessionEvent`.
