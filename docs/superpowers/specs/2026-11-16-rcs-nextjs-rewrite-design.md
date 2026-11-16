# RCS: Next.js UI + Bun Gateway, Accounts, and Server-Side Session Storage

Date: 2026-11-16
Status: Draft for approval
Package: `@sobird/rcs`
Location: `/Users/sobird/claude-code/packages/rcs`

## Intent

We are creating a new, authoritative Remote Control Server in the `sobird/claude-code`
repository. It replaces the existing `packages/remote-control-server` in the other
repository (`Github/claude-code`) for our use, but we do **not** modify or clean up the
old package. The new implementation exists because we want:

1. A modern Next.js web UI instead of a Vite SPA.
2. Real multi-user accounts, so team members can each sign in and manage their own
   Claude Code environments and sessions.
3. Server-side persistence of sessions/transcripts instead of losing everything on a
   process restart.
4. An installable PWA usable on desktop and mobile.
5. A maintainable foundation we own, rather than a demo-grade in-memory store.

The wire protocol used by Claude Code's bridge mode must not change. The CLI keeps
pointing at the server with `CLAUDE_BRIDGE_BASE_URL` and keeps working unmodified.

## Goals

- Preserve the existing bridge protocol surface (`/v1`, `/v2`, `/acp`, `/web`, `/health`).
- Serve the web UI at `/code` and `/code/:sessionId` so CLI-printed links keep working.
- Replace in-memory maps with Postgres persistence for users, API keys, environments,
  sessions, workers, work items, and session events.
- Provide account-based login (admin/member roles) and per-user API keys for the CLI.
- Keep realtime behavior: WebSocket ingress for bridge/ACP, SSE for the UI.
- Ship a responsive, installable PWA in the first release.
- Reuse the existing, well-tested gateway logic and its 15 test files (≈425 tests) as
  the behavioral contract.

## Non-goals

- No changes to `Github/claude-code/packages/remote-control-server`.
- Not reimplementing Anthropic's cloud control plane or OAuth flows.
- No horizontal scaling of the gateway in v1 (single gateway instance).
- No email delivery, signup self-service, or password reset by email.
- No offline transcript access (PWA caches the app shell only).
- No native mobile apps.
- No new chat capabilities beyond what the current UI already offers.
- No attachments (`GET /api/oauth/files/:uuid/content`) or peer-session messaging
  (`POST /v1/sessions/:id/messages`) in v1; planned for phase 2.

## Anti-goals (would mean this failed)

- The CLI bridge must not require code changes or a new env var scheme.
- Team members must not see each other's sessions unless they are admins.
- A gateway restart must not lose session history or user accounts.
- The mobile experience must not be a desktop page squeezed into a phone width.

## Users and roles

- **Admin** — first bootstrapped account. Manages users, sees all environments and
  sessions, manages server-wide settings.
- **Member** — team member with their own account, API keys, environments, and sessions.
  Sees only their own resources.
- **CLI client** — authenticates with a per-user API key (or a legacy server key).

## Architecture (Option C)

Two processes plus Postgres:

```
                    ┌──────────────────────── browser ────────────────────────┐
                    │  Next.js UI (installable PWA)                            │
                    │  /code, /code/:sessionId, /code/login, /code/settings    │
                    └───────────────┬───────────────────────┬─────────────────┘
                                    │ HTTP (pages, BFF)     │ API/SSE/WS
                                    ▼                       ▼
┌───────────────────────┐                    ┌──────────────────────────────┐
│ Next.js (Node) :3000  │  rewrites /v1,/v2  │ Bun gateway :4000            │
│ App Router + BFF      │ ─────────────────▶ │ Hono: /v1 /v2 /acp /web      │
│ Auth.js, access token │                    │ WS ingress, SSE, long-poll   │
└───────────┬───────────┘                    └──────────────┬───────────────┘
            │                                               │
            └──────────────────┬────────────────────────────┘
                               ▼
                        ┌─────────────┐
                        │ PostgreSQL  │
                        └─────────────┘
```

**Why not Next custom server or SSE-only:** Next route handlers cannot accept WebSocket
upgrades. The bridge protocol needs WS for v1 ingress and ACP relay. Keeping a Bun
gateway preserves protocol behavior and lets Next use its standard `next start`
deployment target.

**Runtime split:** Next runs on Node; the gateway runs on Bun (for `hono/bun`,
`upgradeWebSocket`, and Bun WebSocket idle-ping control). Shared modules must avoid
Bun-only APIs. Hono, Drizzle, `jose`, and `node:crypto` are safe on both.

**Single origin, two processes:** In production, Caddy routes by path:

- `/v1/*`, `/v2/*`, `/acp/*`, `/web/*` → gateway (with WS upgrade passthrough)
- `/api/oauth/files/*` → gateway (phase 2; currently a 404 placeholder)
- everything else (`/code/*`, static assets) → Next

In development, run both processes. Next rewrites proxy `/v1`, `/v2`, `/acp`, `/web`
to `http://localhost:4000` for plain HTTP. The browser connects WebSockets and SSE
directly to `NEXT_PUBLIC_RCS_API_URL` (default `http://localhost:4000`) using the
`Authorization` header / WS auth subprotocol, not cookies.

**TLS and origin:** the package ships its own Caddy in `docker-compose.yml`, so a
single public HTTPS origin is guaranteed. With a domain + automatic HTTPS enabled,
Caddy provisions certificates; without one it serves plain HTTP on `:8080` (PWA
installation and push then require an HTTPS proxy). An existing reverse proxy may
replace Caddy as long as it implements the same path routing and WebSocket upgrade
passthrough, and the deployment uses one origin. Auth.js is configured with
`trustHost` and secure cookies on HTTPS; `RCS_BASE_URL` must equal the public origin.

## Directory layout

```
packages/rcs/
├── package.json                 # @sobird/rcs — next, react, hono, drizzle, jose
├── next.config.ts               # basePath '/code', rewrites, Serwist, standalone
├── tsconfig.json                # strict; paths @/…
├── drizzle.config.ts
├── Dockerfile                   # one image, two commands
├── docker-compose.yml           # app + gateway + postgres + caddy
├── src/
│   ├── app/                     # Next App Router (basePath /code)
│   │   ├── layout.tsx  globals.css
│   │   ├── login/page.tsx
│   │   ├── (app)/layout.tsx     # auth guard + shell
│   │   ├── (app)/page.tsx       # dashboard
│   │   ├── (app)/[sessionId]/page.tsx
│   │   ├── (app)/settings/page.tsx
│   │   ├── (app)/admin/page.tsx
│   │   ├── api/auth/[...nextauth]/route.ts
│   │   └── api/access-token/route.ts
│   ├── components/              # ported Radix/Tailwind UI
│   ├── hooks/                   # ported hooks (SSE, commands, models)
│   ├── lib/
│   │   ├── auth.ts              # Auth.js config (scrypt credentials)
│   │   ├── access-token.ts      # sign/verify short-lived API JWT
│   │   ├── api-client.ts        # fetch wrapper with Bearer token
│   │   └── sse-client.ts        # fetch-based SSE parser (headers allowed)
│   ├── db/
│   │   ├── schema.ts            # Drizzle tables
│   │   ├── client.ts            # postgres / pglite factory
│   │   ├── repositories/*.ts    # async repository layer
│   │   └── migrations/
│   ├── services/                # environment, session, work-dispatch,
│   │                            # automation-state, disconnect-monitor
│   ├── transport/               # ws-handler, sse-writer, event-bus,
│   │                            # acp-* handlers, ws-payload
│   ├── routes/                  # Hono route modules, same paths as today
│   ├── auth/                    # api-key, jwt, middleware, cors
│   ├── config.ts                # gateway env
│   └── contracts.ts             # pure types + constants + ID mapping
├── server/
│   └── index.ts                 # Bun entry: Hono app + Bun.serve export
├── public/                      # icons, manifest (Serwist injects SW)
└── tests/                       # unit + PGlite integration tests
```

`src/services`, `src/transport`, `src/routes`, `src/auth`, and `src/contracts.ts` are
imported by both Next (BFF/tests) and the gateway. Keep them runtime-neutral.

## Authentication and authorization

### Accounts

- `users` table with `id`, `username` (unique, case-insensitive), `display_name`,
  `password_hash`, `role` (`admin` | `member`), `disabled_at`, timestamps.
- Password hashing uses `node:crypto` `scrypt` with a per-user salt and a versioned
  encoded string. No native modules; works on Node and Bun.
- Auth.js v5 Credentials provider, JWT session strategy, httpOnly secure cookie.
- Bootstrap: `ADMIN_USERNAME` + `ADMIN_PASSWORD` env creates the first admin on startup
  if no users exist. The admin creates further accounts from `/code/admin` with an
  initial password; members can change their own password in settings.
- No email, signup, or reset flows in v1.

### Access token for API/SSE/WS

The UI cannot read the httpOnly Auth.js cookie, and `EventSource`/WebSocket header
support is limited. Therefore:

1. `POST /code/api/access-token` (Next, requires a valid session) returns a short-lived
   HS256 JWT signed with `RCS_AUTH_SECRET`: `{ sub, username, role, exp: now+5m }`.
2. The UI sends it as `Authorization: Bearer <jwt>` for HTTP and SSE (fetch-based
   reader), and as the `rcs.auth.<base64url(jwt)>` WebSocket subprotocol.
3. The gateway verifies it with the same secret (`jose`). No DB call per request.
4. The UI refreshes the token before expiry (and on 401).

Bridge clients keep their existing credential flow: an API key for CLI login, an
environment token for environment-scoped calls, and worker JWTs for session ingress.
The token _format_ changes internally (all signed with `RCS_AUTH_SECRET`) but clients
treat these values as opaque strings, so no client code changes are needed.

### API keys

- `api_keys` table: `id`, `user_id`, `name`, `token_prefix` (display), `token_hash`
  (sha256), `last_used_at`, `revoked_at`, `created_at`.
- Members create/revoke their own keys in settings; admins see all keys. The raw key
  is shown exactly once at creation.
- The CLI sets `CLAUDE_BRIDGE_OAUTH_TOKEN=<user key>`.
- API-key validation is a hash lookup per request. CLI traffic is low-frequency
  (poll every ~8 s), so this is cheap. Revocation takes effect on the next request.
- Legacy `RCS_API_KEYS` remains supported for bootstrap and compatibility; those keys
  map to the bootstrap admin user.

### Environment and session credentials (no required shared key)

The bridge protocol returns an `environment_secret` and embeds a
`session_ingress_token` in each work item. Today both are the first server API key.
With per-user hashed keys we cannot echo a raw key, so the new server issues
self-contained HS256 tokens signed with `RCS_AUTH_SECRET`:

- **Environment token** — `environment_secret` returned by
  `POST /v1/environments/bridge`. Claims: `{ role: 'environment', env_id, user_id,
exp }` (default 30 days, renewed on re-registration). Accepted by an
  `environmentAuth` middleware for poll/ack/stop/heartbeat/reconnect, which verifies
  the route `:id` matches `env_id`.
- **Session ingress token** — `session_ingress_token` in the work secret. Claims:
  `{ role: 'worker', session_id, exp }`. Accepted by the existing
  `sessionIngressAuth` (already verifies `session_id` against the route).
- **Worker JWT** — `/v1/code/sessions/:id/bridge` continues to return a worker JWT,
  now signed with `RCS_AUTH_SECRET` instead of an API key.

This keeps the wire contract identical (clients treat both values as opaque strings),
works in an accounts-only deployment, and removes any requirement to configure a
global secret in `RCS_API_KEYS`. API keys remain only for CLI login, ACP linking, and
legacy bootstrap.

### ACP authentication

ACP routes accept both credentials, with ownership filtering:

- API key (Bearer) — `acp-link` CLI, unchanged.
- Access-token JWT (Bearer / WS subprotocol) — browser ACP UI.

`GET /acp/agents` and `/acp/channel-groups*` return only agents owned by the caller
(admins see all). `WS /acp/relay/:agentId` verifies the caller owns the target agent.
`WS /acp/ws` remains API-key-only (it is a machine-to-machine link).

### Ownership rules

- Environments are owned by the user whose credential registered them.
- Sessions inherit ownership from their environment; sessions created from the web UI
  are owned by the creating user.
- Members can only list/read/write their own environments and sessions. Admins can
  access all.
- Legacy unowned sessions (created by a global key or ACP without an owner) appear in
  an "Unclaimed" section to all authenticated users. Claiming is an explicit atomic
  `UPDATE … WHERE owner_user_id IS NULL` performed only by a **member** action
  (opening and interacting / pressing "Claim"). Admins can view unclaimed sessions
  through their admin override without claiming them, so browsing cannot steal them.
- The current `?uuid=` query mechanism is removed from the web API in favor of Bearer
  tokens. The old `uuidAuth` middleware is replaced; no UUID appears in URLs.

### Account lifecycle and revocation

- Disabling a user blocks login and access-token minting immediately. Outstanding
  access tokens remain valid until their 5-minute expiry.
- Each live SSE/WS connection re-checks the user's status at most once per minute and
  is closed with a policy code if the user became disabled. This bounds the guarantee
  at ~1 minute without a DB lookup per frame.
- Revoking an API key takes effect on the next CLI request (hash lookup).
- Disabling a user does not delete environments, sessions, or history. Those remain
  visible to admins; the disabled user cannot sign in. Environments stop working once
  their token is rejected at the next poll.
- Password changes do not invalidate existing access tokens (≤5 min window).

### Login protection

- In-memory token bucket on `/code/login` and `/code/api/access-token`: 5 attempts per
  minute per `(ip, username)`, with exponential backoff after repeated failures.
  No persistent lockout and no admin audit log in v1.

## Data model (Postgres, Drizzle)

```
users(id uuid pk, username text unique, display_name, password_hash,
      role, disabled_at, created_at, updated_at)
  -- usernames are stored lowercase; login normalizes input

api_keys(id uuid pk, user_id fk, name, token_prefix, token_hash unique,
         last_used_at, revoked_at, created_at)

environments(id text pk, owner_user_id fk, machine_name, directory,
             branch, git_repo_url, max_sessions, worker_type, bridge_id,
             capabilities jsonb, status, last_poll_at, created_at, updated_at)

sessions(id text pk, environment_id fk, owner_user_id fk, title, status,
         source, permission_mode, worker_epoch, created_at, updated_at,
         archived_at)

session_workers(session_id pk fk, worker_status, external_metadata jsonb,
                requires_action_details jsonb, last_heartbeat_at,
                created_at, updated_at)

work_items(id text pk, environment_id fk, session_id fk, state, secret,
           created_at, updated_at)

session_events(id bigserial pk, event_id uuid, session_id fk, type,
               payload jsonb, direction, created_at)
  index (session_id, id)
```

- `session_events.id` is used as the SSE `Last-Event-ID`/`seqNum`. It is globally
  monotonic, which guarantees per-session monotonicity without per-session counters.
- Work-item claim uses a transaction with `FOR UPDATE SKIP LOCKED`:
  `pending → dispatched`, then `acked`/`completed`.
- Session worker updates keep the current automation-state diff → event publication.
- Indexes: environments(status, owner_user_id), sessions(owner_user_id, status),
  work_items(environment_id, state), api_keys(token_hash), users(username).
- Migrations are committed SQL generated by `drizzle-kit`, applied on startup via a
  lock-protected migrator.

### Repository layer

The current `store.ts` is synchronous (Maps). The new repository API is **async**, and
services/routes are updated accordingly. Repositories are interfaces with:

- a Postgres implementation (production),
- a PGlite implementation for integration tests (same SQL dialect),
- an in-memory fake for fast unit tests of pure service logic.

To limit drift, service unit tests should cover branching/validation; SQL behavior is
covered by PGlite integration tests that run in `bun test` without Docker.

## Realtime pipeline

### Bridge ingress (unchanged protocol)

- v1: `GET /v1/session_ingress/ws/:sessionId` (also `/v2/...`), NDJSON frames,
  API key or worker JWT, auth via header or `rcs.auth.*` subprotocol.
- v2: `GET /v2/session_ingress/ws/:sessionId` plus
  `POST /v2/session_ingress/session/:sessionId/events`.
- Inbound messages are normalized exactly as today (`ingestBridgeMessage`): derive
  type, shape payloads, publish to the session event pipeline.
- Playback on WS open replays the most recent `RCS_EVENT_REPLAY_LIMIT` events
  (default 5000, matching today's practical cap) so the bridge can reconstruct
  conversation history. The UI history endpoint paginates older events instead of
  relying on unbounded replay.

### Publishing and persistence

Every bridge/session event is:

1. Assigned an event ID and written to `session_events` (write-through), then
2. Published to an in-process `EventBus` for fan-out to live subscribers.

Publishing waits for the insert to succeed; if the write fails, the request fails
rather than silently dropping history. The in-memory bus is a cache only; durable
replay always comes from Postgres.

ACP channel-group events are the exception: they stay in-memory and ephemeral in v1.
The durability guarantee applies to bridge sessions. This narrows the anti-goal
"a restart must not lose session history" to session history; ACP relay history is
explicitly best-effort.

### UI stream

- `GET /web/sessions/:id/events` remains an SSE endpoint, now Bearer-authenticated.
- The UI consumes SSE with `fetch` + `ReadableStream` (not `EventSource`) so the
  Authorization header can be sent. `Last-Event-ID` triggers DB replay from that ID.
- `POST /web/sessions/:id/events`, `/control`, `/interrupt` keep their semantics,
  publish `direction: 'outbound'` events.

### Multiple gateway instances

v1 assumes one gateway. Cross-instance fan-out (Postgres `LISTEN/NOTIFY`) is designed
for but not implemented; the DB remains the source of truth, so a second instance
would still serve history correctly, only live fan-out would be incomplete.

## Web UI scope

Ported from the existing SPA, rebuilt as App Router pages:

- **Login** — username/password, redirects back to `next`.
- **Dashboard** (`/code`) — environments (status, worker type, last seen), sessions
  (active/archived, owner), "new session" dialog, API key hint, connection state.
- **Session detail** (`/code/:sessionId`) — chat stream (assistant text, reasoning,
  tool calls, tool results), permission/control cards, plan view, interrupt, reconnect
  and "resume from last event" behavior, mobile-first layout.
- **Settings** (`/code/settings`) — account, password change, API keys (create/revoke),
  theme.
- **Admin** (`/code/admin`) — users (create, disable, role), all environments/sessions.
- **ACP** — connect flow and direct ACP view (relay WS) preserved; API-key auth as today.

UI stack: Next App Router, React 19, Tailwind v4, Radix primitives (existing
components), `lucide-react`, AI SDK UI primitives where already used. Design language
follows `.impeccable.md` from the old repo: warm neutrals, Claude orange accents,
density with clarity, ample whitespace; no gradients/glass/neon.

**Rendering model:** pages are client-rendered for data. Server components handle the
auth guard, layout, and metadata; they fetch the current Auth.js session but do not
proxy gateway data. The browser obtains an access token from
`/code/api/access-token` and calls the gateway directly for `/web/*`, SSE, and WS.
Initial loads show the app shell plus skeletons; there is no server-side mirror of
gateway state to keep in sync. The Next "BFF" is limited to Auth.js and the
access-token endpoint; it is not a general API proxy (Next rewrites cover that in dev).

### SSE/WS client details

- Base URL for gateway calls: `NEXT_PUBLIC_RCS_API_URL` in dev, same origin in prod.
- WS URL derived from that base; auth via subprotocol.
- Reconnects use exponential backoff; the UI remembers the last event ID and asks the
  server to replay from it.
- Cross-origin dev requires gateway CORS for `/web/*` with the Next dev origin; the
  existing `webCorsOptions` is reused and configured by env.

## PWA

- **Serwist** with `@serwist/next`, `basePath: '/code'`, service worker at
  `/code/sw.js`, scope `/code/`.
- Web app manifest: name, short name, icons (192/512, maskable), `display:
standalone`, theme colors from the design tokens.
- Precached app shell and static assets; **no** caching of API/SSE responses.
- Install prompt surfaced in settings and on mobile.
- Responsive breakpoints: dashboard stacks; session view uses a full-height chat with
  a collapsible session drawer; permission controls are thumb-reachable.
- **Web Push is phase 2.** Phase 1 delivers an installable, responsive PWA. Push needs
  VAPID keys, `push_subscriptions`, and HTTPS, and on iOS works only for installed
  PWAs (16.4+). Design leaves room for it but does not block the first release.

## Server-side session storage

- Event history lives in Postgres and is replayed to the bridge and UI on reconnect.
- The session list and titles are durable; archive marks `archived_at` and stops live
  streams but keeps history readable.
- No retention deletion in v1; add `RCS_EVENT_RETENTION_DAYS` in phase 2. Expected
  growth is modest for a team; document the tradeoff.
- Local JSONL transcripts on the developer machine remain authoritative for the CLI;
  the server stores the remote-control event stream, not a second transcript format.

## Protocol and compatibility contract

Keep these routes and payload shapes unchanged:

| Area          | Routes                                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environments  | `POST /v1/environments/bridge`, `DELETE /v1/environments/bridge/:id`, `POST /v1/environments/:id/bridge/reconnect`, `GET/POST /v1/environments/:id/work…` |
| Sessions      | `POST /v1/sessions`, `POST /v1/sessions/:id/archive`, `POST /v1/sessions/:id/events`                                                                      |
| Ingress       | `WS /v1/session_ingress/ws/:id`, `WS /v2/session_ingress/ws/:id`, `POST /v2/session_ingress/session/:id/events`                                           |
| Code sessions | `POST /v1/code/sessions`, `POST /v1/code/sessions/:id/bridge`, worker CRUD/heartbeat/register, `GET /v1/code/sessions/:id/worker/events/stream`           |
| ACP           | `GET /acp/agents`, `/acp/channel-groups*`, `WS /acp/ws`, `WS /acp/relay/:agentId`                                                                         |
| Web           | `/web/sessions*`, `/web/environments`, `/web/bind` (deprecated), `/web/auth/*`                                                                            |
| Ops           | `GET /health`                                                                                                                                             |

Improvements included in the new implementation:

- Idempotent environment re-registration when the client sends `environment_id`.
- Per-user ownership enforcement on all web endpoints.
- Notification of waiting pollers when work is enqueued (no fixed 500 ms latency).
- Graceful shutdown closes WS connections and drains writes.

## Delivery phases

1. **Scaffold** — package, tsconfig, oxlint/oxfmt, Next + Tailwind + Serwist skeleton,
   Drizzle schema and migrations, Docker Compose, health check.
2. **Gateway port** — copy `routes/`, `transport/`, `services/`, `auth/`, `types/`
   into the runtime-neutral layout; replace `store.ts` with async repositories;
   convert tests to PGlite.
3. **Accounts and UI** — Auth.js login, access-token endpoint, ownership checks,
   dashboard/session/settings/admin pages, fetch-based SSE, direct WS.
4. **PWA** — manifest, service worker, install prompt, mobile layout polish.
5. **Hardening** — reconnection/replay tests, lifecycle cleanup, CLI end-to-end smoke
   with `CLAUDE_BRIDGE_BASE_URL`, deployment docs.
6. **Phase 2** — Web Push, attachments endpoint, peer messages, event retention,
   shared sessions, multi-instance fan-out.

## Testing and quality gates

- `bun test` in the package: port the 15 gateway test files, add repository tests on
  PGlite, add access-token/ownership tests, and a small UI hook test suite.
- Repo commands must pass: `bun run typecheck`, `bun run lint`, `bun run fmt:check`,
  `bun test`. The target repository (`sobird/claude-code`) uses **oxlint + oxfmt**
  (not Biome); `packages/rcs` follows the root configuration and hooks. The Biome
  setup mentioned in the old repository does not apply here.
- Manual smoke: register an environment with the real CLI, create a session from the
  UI, exchange messages, approve a permission, reconnect, restart the server, and
  confirm history replays.

## Configuration

| Variable                                                                                                                                         | Used by | Purpose                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | --------------------------------------------------------------- |
| `DATABASE_URL`                                                                                                                                   | both    | Postgres connection                                             |
| `RCS_AUTH_SECRET`                                                                                                                                | both    | HS256 secret for access, environment, and worker tokens         |
| `RCS_ENV_TOKEN_TTL`                                                                                                                              | gateway | Environment token lifetime (default 30 days)                    |
| `RCS_API_KEYS`                                                                                                                                   | gateway | Legacy/bootstrap keys only (optional)                           |
| `RCS_EVENT_REPLAY_LIMIT`                                                                                                                         | gateway | Max events replayed on WS open (default 5000)                   |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`                                                                                                               | Next    | Bootstrap admin                                                 |
| `RCS_BASE_URL`                                                                                                                                   | gateway | Public origin used in work secrets                              |
| `RCS_GATEWAY_URL`                                                                                                                                | Next    | Internal proxy target (default `http://localhost:3000`→gateway) |
| `NEXT_PUBLIC_RCS_API_URL`                                                                                                                        | browser | Gateway origin in dev                                           |
| `RCS_PORT`, `RCS_HOST`                                                                                                                           | gateway | Listen address                                                  |
| `RCS_POLL_TIMEOUT`, `RCS_HEARTBEAT_INTERVAL`, `RCS_JWT_EXPIRES_IN`, `RCS_DISCONNECT_TIMEOUT`, `RCS_WS_IDLE_TIMEOUT`, `RCS_WS_KEEPALIVE_INTERVAL` | gateway | Same semantics as today                                         |
| `RCS_WEB_CORS_ORIGINS`                                                                                                                           | gateway | Allowed dev origins                                             |

## Risks and mitigations

| Risk                                                   | Mitigation                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Async repository refactor ripples through all services | Do it in phase 2 before UI work; keep service signatures async from day one   |
| Next rewrites buffering SSE                            | UI talks to the gateway directly for SSE/WS; Caddy routes by path in prod     |
| Bun/Node API divergence in shared code                 | Lint rule/import boundary: shared modules cannot import `hono/bun` or `Bun.*` |
| Auth.js version churn                                  | Pin a major version; access token uses plain `jose`                           |
| DB growth from events                                  | Indexed schema, bounded WS replay, paginated history, retention phase 2       |
| ACP relay history is not durable                       | Explicitly scoped out of the durability goal; documented for ACP users        |
| Disabled users keep live streams up to 1 minute        | Periodic per-connection status check, documented bound                        |
| PWA push expectations on iOS                           | Push explicitly phase 2, installed-only, documented                           |
| Two processes complicate local setup                   | A single `bun run dev` starts both with clear output                          |

## Decisions made here (builder may challenge with reason)

1. Postgres + Drizzle rather than SQLite — multi-user concurrency, JSONB payloads,
   and a single-writer network service make Postgres the safer default.
2. Auth.js credentials + short-lived HS256 access tokens — avoids cookies on WS/SSE
   and avoids DB lookups per request.
3. `scrypt` from `node:crypto` for passwords — no native build steps on either runtime.
4. Keep `basePath: '/code'` — the CLI prints `<base>/code[/:sessionId]`; changing it
   would break existing links.
5. Persist events write-through, not fire-and-forget — history correctness is the main
   reason for this rewrite.
6. Single gateway instance in v1 — matches the target team size; DB remains the source
   of truth for later horizontal scaling.
7. Web Push deferred to phase 2 — installability and mobile usability come first.
8. Remove UUID-based web auth — accounts and per-user ownership replace it; legacy
   `RCS_API_KEYS` still works for the CLI.
9. Environment credentials are short-lived signed JWTs (`environment_secret`) rather
   than stored shared keys — the client contract is unchanged and no global key is
   required in an accounts-only deployment.
10. `/acp/*` accepts access-token JWTs with ownership filtering; `acp-link` keeps API
    keys. Members only see their own ACP agents.
11. Pages are client-rendered for gateway data; the Next BFF is only Auth.js and the
    access-token endpoint.
12. ACP channel-group history is ephemeral in v1; bridge session history is durable.
13. Unclaimed legacy sessions are claimed only by explicit member action, never by an
    admin merely viewing them.
14. Login/access-token endpoints are rate-limited in memory; no audit log in v1.

## Left to the builder

- Exact Next/React/Serwist versions available at implementation time.
- Component-level migration order and visual polish details.
- Migration tooling ergonomics (script names, seeding).
- Whether to run the gateway TS directly under Bun in production (default) or bundle it.
- Test file layout and fixture design.
