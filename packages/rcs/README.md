# @sobird/rcs — Remote Control Server

Self-hosted control plane for Claude Code "remote control" sessions. One Postgres
database, a Next.js web UI, and a Bun gateway that speaks the bridge/ACP
protocols.

```
              ┌────────────────────────── Caddy (single origin) ──────────────────────────┐
  browser ───▶│ /* → Next UI (:3000), except        /v1 /v2 /acp /web → Bun gateway (:4000) │
  CLI     ───▶│                                                                          │
              └──────────────────────────────────────────────────────────────────────────┘
                                        │                              │
                                        └───────── Postgres 16 ─────────┘
```

- **Next UI** (port 3000, served at the origin root): login, dashboard, session
  detail, settings (API keys), admin (user management), PWA.
- **Gateway** (Bun, port 4000): `/v1`, `/v2`, `/web`, `/acp`, `/health`. Applies
  database migrations at startup and runs the disconnect monitor.
- **Caddy**: routes both surfaces on one origin so the browser can use relative
  URLs (`/web/...`, `/acp/...`) and WebSocket upgrades work without extra
  configuration in production.

## Quick start (Docker Compose)

```bash
cd packages/rcs
cp .env.example .env

# 1. Generate a real signing secret and put it in .env as RCS_AUTH_SECRET.
openssl rand -hex 32

# 2. Set ADMIN_USERNAME / ADMIN_PASSWORD (used only on first boot).

# 3. Start everything (Postgres + gateway + app + Caddy).
docker compose up -d --build
```

Open <http://localhost/login> and sign in with the bootstrap admin.

By default Caddy serves plain HTTP on port 80, which is the intended
local/demo mode. To serve over HTTPS, set `RCS_DOMAIN=rcs.example.com` (and
`RCS_BASE_URL=https://rcs.example.com` for CLI-facing work secrets) in `.env`;
Caddy then obtains a certificate automatically. This requires inbound TCP ports
80 and 443 (and optionally UDP 443 for HTTP/3) to be reachable. `/health` is
proxied by Caddy, so it is available at the public origin as well.

The `postgres`, `app`, `gateway` and `caddy` services share one image built from
`Dockerfile`. The `gateway` service overrides the default command with
`bun /app/dist/gateway.js`; `app` runs the Next standalone server.

> The compose build context is the repository root (`../..`) because this package
> is a Bun workspace member and `bun install --frozen-lockfile` needs the root
> lockfile and workspace manifests. Build rules live in `Dockerfile.dockerignore`.

### Without Docker (development)

If you do not already have a Postgres 16 reachable, start one:

```bash
docker run -d --name rcs-pg -p 5432:5432 \
  -e POSTGRES_USER=rcs -e POSTGRES_PASSWORD=rcs -e POSTGRES_DB=rcs \
  postgres:16-alpine
```

Then run both processes from source:

```bash
cd packages/rcs
export DATABASE_URL=postgres://rcs:rcs@127.0.0.1:5432/rcs
export RCS_AUTH_SECRET=$(openssl rand -hex 32)
export ADMIN_USERNAME=admin ADMIN_PASSWORD=change-me
export RCS_WEB_CORS_ORIGINS=http://localhost:3000   # dev UI calls the gateway cross-origin
bun install
bun run dev          # Next dev on :3000 + gateway on :4000
```

`scripts/dev.ts` sets `NEXT_PUBLIC_RCS_API_URL=http://localhost:4000` for you;
the UI calls the gateway directly in development. Because that is a cross-origin
call, the UI origin must be in `RCS_WEB_CORS_ORIGINS` or `/web/*` responses carry
no CORS headers.

## Accounts, roles and API keys

- On an **empty users table**, `ensureBootstrapAdmin` creates `ADMIN_USERNAME`
  (lowercased) with `ADMIN_PASSWORD` and role `admin`. It never runs again once
  any user exists. The Next process runs it from `src/instrumentation.ts` (and
  retries on login if the first attempt raced the schema).
- Admins create and manage members at `/admin`. Roles are `admin` and
  `member`; members only see their own sessions plus the shared "unclaimed"
  pool; admins see everything.
- Each user creates and revokes **API keys** at `/settings`. Keys are shown
  once (`rcs_...`); only a SHA-256 hash is stored. The CLI authenticates with
  these keys.
- `RCS_API_KEYS` (comma separated) remains as a legacy escape hatch; legacy keys
  map to the first enabled admin. Prefer per-user keys.

## Pointing the CLI at this server

`remote-control` talks to the gateway over HTTPS/HTTP using a bearer token. In
this build the `CLAUDE_BRIDGE_*` overrides are gated on `USER_TYPE=ant`, and a
configured `CLAUDE_BRIDGE_BASE_URL` marks the bridge as self-hosted — the
claude.ai subscription/scope/GrowthBook gates are skipped, so no `/login` is
needed:

```bash
# CLAUDE_BRIDGE_OAUTH_TOKEN is a per-user API key created at /settings.
USER_TYPE=ant \
CLAUDE_BRIDGE_BASE_URL=https://rcs.example.com \
CLAUDE_BRIDGE_OAUTH_TOKEN=rcs_... \
bun scripts/dev.ts remote-control
```

Run the command from this repository (or a build of it). The public npm `claude`
binary does not contain the `CLAUDE_BRIDGE_*` overrides.

- `CLAUDE_BRIDGE_BASE_URL` — public origin of this deployment.
- `CLAUDE_BRIDGE_OAUTH_TOKEN` — a per-user RCS API key. It is sent as
  `Authorization: Bearer …` on every bridge call.
- `CLAUDE_BRIDGE_SESSION_INGRESS_URL` — optional; defaults to the base URL.
  Set it explicitly only if session ingress is served from a different host.
- `CLAUDE_BRIDGE_USE_CCR_V2` — **do not set it against this gateway.** The
  gateway always reports `use_code_sessions: false`; the v2 code-sessions path
  this override forces authenticates with a worker JWT against
  `POST /v1/code/sessions/:id/worker/register`, which only accepts a user
  credential, so the session fails. The default (legacy) path is the supported
  one.

The base URL must be HTTPS unless it is localhost/127.0.0.1. The CLI registers an
environment, long-polls for work, and opens a WebSocket for the selected session.

## ACP agents and relay

The gateway exposes ACP transports under `/acp`:

- `GET /acp/ws` — agent transport (API-key authenticated). Long-lived ACP agents
  connect here and register as `worker_type: acp` environments.
- `GET /acp/agents`, `GET /acp/channel-groups`, `GET /acp/channel-groups/:id`,
  `GET /acp/channel-groups/:id/events` — owner-scoped discovery and event stream.
- `GET /acp/relay/:agentId` — browser relay (access token or API key); the web
  UI uses it to talk to a selected agent. Caddy upgrades these WebSockets
  transparently.

## Same-host vs split-host

**Same origin (default, recommended).** `NEXT_PUBLIC_RCS_API_URL` is empty and
Caddy routes `/v1 /v2 /acp /web` to the gateway and everything else to Next. The
browser then calls relative URLs.

**Split host.** If the UI and gateway live on different origins:

1. Build the image with
   `--build-arg NEXT_PUBLIC_RCS_API_URL=https://gateway.example.com` (the value is
   baked into client bundles at build time — rebuild after changing it).
2. Point the gateway's `RCS_WEB_CORS_ORIGINS` at the UI origin so `/web/*`
   responses carry CORS headers.
3. Serve both hosts over HTTPS and route the gateway host to `:4000`, the UI host
   to `:3000`.

## PWA

The UI is installable: it ships a web manifest (`/manifest.webmanifest`) and
a Serwist service worker served at `/serwist/sw.js`. Open the site in a
supported browser and use "Install app". Manifest/service-worker routes are
excluded from the auth middleware so installation works before login.

## Migrations

- **Automatic:** the gateway calls `runMigrations` at startup (`server/index.ts`),
  before it accepts traffic. Migrating first also ensures the Next process sees
  the schema when it provisions the bootstrap admin.
- **Manual:** run the same runner against the database:

  ```bash
  # source (dev)
  DATABASE_URL=postgres://... bun src/db/migrate.ts
  # bundled artifact (inside the image)
  DATABASE_URL=postgres://... bun /app/dist/migrate.js
  ```

  The bundle resolves `migrations/` next to itself; the image copies the SQL and
  `meta/` to `/app/dist/migrations`.

## Healthchecks

| Service  | Check                                    |
| -------- | ---------------------------------------- |
| gateway  | `curl -fsS http://127.0.0.1:4000/health` |
| app      | `curl -fsS http://127.0.0.1:3000/login`  |
| postgres | `pg_isready -U rcs -d rcs`               |

`docker compose ps` shows them; `app` waits for `gateway` to be healthy so
migrations exist before login/bootstrap.

## Environment reference

All variables are documented with safe examples in [`.env.example`](./.env.example).
The most important:

| Variable                            | Required   | Purpose                                                                                                                                                                                         |
| ----------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                      | yes        | Postgres DSN for the UI and gateway                                                                                                                                                             |
| `RCS_AUTH_SECRET`                   | yes        | JWT/session signing secret (shared by both processes)                                                                                                                                           |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | first boot | Bootstrap admin                                                                                                                                                                                 |
| `RCS_PORT` / `RCS_HOST`             | no         | Gateway listen address (default `4000` / `0.0.0.0`)                                                                                                                                             |
| `RCS_BASE_URL`                      | no         | Public origin embedded in work secrets (default `http://localhost:4000`)                                                                                                                        |
| `NEXT_PUBLIC_RCS_API_URL`           | no         | Gateway origin for split-host UI (baked at build)                                                                                                                                               |
| `RCS_DOMAIN`                        | no         | Caddy site address; empty → HTTP :80, set → automatic HTTPS                                                                                                                                     |
| `RCS_WEB_CORS_ORIGINS`              | split-host | Origins allowed to call `/web/*`                                                                                                                                                                |
| Tunables                            | no         | `RCS_POLL_TIMEOUT`, `RCS_HEARTBEAT_INTERVAL`, `RCS_JWT_EXPIRES_IN`, `RCS_ENV_TOKEN_TTL`, `RCS_DISCONNECT_TIMEOUT`, `RCS_WS_IDLE_TIMEOUT`, `RCS_WS_KEEPALIVE_INTERVAL`, `RCS_EVENT_REPLAY_LIMIT` |

## Smoke check

`bun run smoke` (or `bun scripts/smoke.ts`) boots the gateway in-process with the
in-memory repositories and asserts `/health` → 200, authenticated
`POST /v1/environments/bridge` → 200 with a verifiable environment token, and an
unauthenticated `GET /web/sessions` → 401. It needs no database or external env.

## Manual end-to-end smoke

1. `docker compose up -d --build`, open `http://localhost/login`.
2. Sign in as the bootstrap admin.
3. In `/admin`, create a member user with a password.
4. Sign in as that member and open `/settings`; create an API key and copy it.
5. On the machine that will run sessions (from `packages/rcs` in this repo):

   ```bash
   USER_TYPE=ant \
   CLAUDE_BRIDGE_BASE_URL=http://localhost \
   CLAUDE_BRIDGE_OAUTH_TOKEN=rcs_... \
   bun scripts/dev.ts remote-control
   ```

6. The environment appears in the UI. Start a session (web UI or CLI), open it in
   the dashboard, and confirm messages stream live (SSE) and the session history
   survives a reload (durable events).
