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

## Web UI

The Next app (`src/app`) is the operator surface over the gateway's `/web` API
and SSE stream.

### Dashboard

- Lists active environments (`Claude Code` / `ACP Agent`) and sessions; members
  see their own plus the shared unclaimed pool, admins see everyone.
- **New session** starts a session on a connected environment (or leaves it
  unassigned) with an optional title.
- The empty state shows the CLI command used to connect a machine.

### Session chat

- Live text via SSE deltas (set `CLAUDE_CODE_INCLUDE_PARTIAL_MESSAGES=1` on the
  CLI); durable events replay on reload, and reconnects show a banner.
- Markdown with syntax-highlighted code (lazy-loaded), collapsible thinking
  blocks, and tool cards that summarize the call (command, file, pattern…),
  group repeated calls, and expand to the raw input and output. A header toggle
  expands or collapses every tool card at once; individual cards still toggle on
  their own.
- **History pages in as you scroll back** (100-event pages) without shifting
  the viewport. Long sessions render a bounded window of the newest messages
  (80 grouped items); scrolling near the top reveals older ones in the same
  chunks, keeping the message you were reading anchored in place, and fetches
  another page once everything locally loaded is on screen. There is no
  load-earlier button — a short session whose transcript fits the viewport
  preloads the next page automatically.
- A turn-duration line closes each completed turn.
- Copy buttons on assistant replies and on your own messages.
- **Keyboard message navigation** mirrors the TUI: Shift+↑ enters the cursor on
  the newest prompt, ↑/↓ or j/k move, Shift+↑/↓ hop between user messages,
  Cmd+↑/↓ jump to the ends. Enter edits a selected prompt or expands/collapses a
  tool group, `c` copies the message, `p` copies the selected tool's primary
  input (command, path, pattern…), and Esc or Ctrl+C exits. The cursor only binds
  while no input is focused and never steals keys the approvals panel handles.
- **Detailed transcript** (header toggle or Ctrl+O, like the TUI) reveals
  informational rows the reducer otherwise hides: context compaction, API
  errors, stop-hook summaries, saved memory, permission retries, and local
  command output.
- **Image attachments**: paste an image or pick one with the composer button
  (PNG/JPEG/GIF/WebP, up to 5 per message). Large images are downscaled and
  re-encoded as JPEG before upload, stored deduped by content hash, and sent to
  the CLI as base64 at delivery time; the transcript keeps only a reference, so
  images still render after a reload. Images can also be dragged onto the
  composer.
- Any prompt can be **edited in place** (the bubble becomes a textarea: Enter
  sends, Shift+Enter inserts a newline, Esc cancels), and the latest reply can
  be **regenerated**. Both resend as a new turn because the bridge has no
  conversation rewind: the previous exchange stays in the transcript and files
  are not restored.
- The header shows recent **token usage** (prompt = input + cached) from the
  latest assistant message, with the breakdown in the tooltip; the CLI reports
  `total_cost_usd` as 0, so cost is not shown.
- A **keyboard shortcut** reference opens from the header icon or the `?` key
  (outside inputs).
- **Todo panel**: derived from `TodoWrite` input (the same source the TUI uses),
  showing a progress bar and the active item, collapsing to a summary line, and
  hiding once everything is done. Upstream `task_state` events are accepted too
  if a bridge sends them.
- Auto-follows streaming output while you are at the bottom; scrolling up
  reveals a **Jump to latest** button. Failed sends show an inline retry card.
- Archived sessions disable the composer; a disconnected stream shows the
  gateway error.
- While the tab is hidden and approvals are waiting, the tab title shows the
  pending count.

### Composer

- Enter sends; Shift+Enter inserts a newline. Mid-turn sends are queued by the
  CLI (matching the TUI) and show a **Queued** label under the bubble until the
  current turn's result arrives; Esc or the stop button interrupts while the
  agent runs.
- **Prompt history**: ↑ recalls earlier prompts from the first line of the
  draft, ↓ walks forward and restores the draft after the newest entry. History
  persists in `localStorage`, capped at 50 entries. Ctrl+R opens a filter over
  the same history; ↑/↓ navigate, Enter/Tab insert without sending, Esc closes.
  Only Ctrl+R is bound, so Cmd+R still reloads the page.
- **Slash commands**: `/` opens a filtered menu of the bridge-safe commands
  reported by `system/init`; ↑/↓ navigate, Tab/Enter accept without sending, Esc
  closes. IME composition is ignored. The standalone `remote-control` CLI
  reports the list at the start of every turn; with the interactive REPL bridge
  set `CLAUDE_INTERNAL_FC_OVERRIDES='{"tengu_bridge_system_init":true}'` to
  receive it on connect.
- **`@` file references**: `@` opens a menu of paths from the CLI's project index
  (git-aware), filtered as you type; ↑/↓ navigate, Tab/Enter insert the path
  without sending, Esc closes. Paths with spaces are inserted as `@"…"`.
  Completion queries travel over the bridge socket directly — they are not
  stored in `session_events`. If the bridge is offline or slow the menu degrades
  to plain text entry. Both bridge modes serve the queries.
- **Permission mode** control in the session header shows the mode reported by
  `system/init` and switches it with a `set_permission_mode` control request:
  ask each time, auto-accept edits, plan, don't ask, bypass. The UI updates only
  from the CLI's reply and surfaces CLI errors (for example bypass without
  `--dangerously-skip-permissions`). Shift+Tab cycles the same modes in TUI
  order (ask each time → auto-accept edits → plan → bypass); don't ask is not
  part of the cycle.
- **Model** control in the session header shows the model reported by
  `system/init` and switches it with a `set_model` control request. The menu
  lists the CLI's own models, fetched once per connection through an
  `initialize` control request; the interactive REPL bridge reports none, so a
  free-text model ID is always available as a fallback.
- **Extended thinking** control sends `set_max_thinking_tokens`: Default (`null`,
  the CLI's own default), On (an explicit budget the CLI clamps to the model's
  output limit), or Off (`0`). `system/init` carries no thinking state, so the
  header shows only the last choice confirmed by the CLI and resets to Default on
  reload. On the interactive REPL bridge (`useReplBridge`) a `0` budget is read
  as enabled — the print/SDK path used by `remote-control` behaves correctly, so
  toggle thinking in the TUI there if the REPL bridge ignores Off.

### Approvals

- Permission cards show the tool input, a line diff for file edits, blocked-path
  hints, the CLI's `decision_reason` when it sends one, and the CLI's
  suggestions (allow for this session / always / this directory). Denials can
  carry a message back to the model.
- An "always allow" suggestion that carries exactly one rule gets an **edit**
  button: rewrite the rule content (`Bash` → `Bash(npm test:*)`) before applying
  it. An empty value persists the bare tool rule. Multi-rule, deny, and mode
  suggestions are still applied as sent.
- **AskUserQuestion** renders the questions as radio/checkbox groups with a free
  text "Other" answer and submits the CLI's answers map. With the card focused,
  1–9 pick an option, ←/→ switch questions, ↑/↓ move the highlight, Enter
  submits, and Esc declines; text fields keep their own keys.
- **ExitPlanMode** renders the full plan as markdown with the permissions it
  requests, offering approve, approve-and-auto-accept-edits, or reject with
  feedback. The plan dialog supports `A` approve, `D` reject, `Enter` approve,
  and `Esc` close while it is not typing.
- If the CLI resolves a request locally (hook, classifier, permission-mode
  recheck) it sends `control_cancel_request`; the web drops the stale card and
  the bound tool call resumes instead of hanging.

### Settings and account

- Password change, personal API keys (shown once, hashed at rest), and a
  light/dark/system theme.
- **Language**: per-user interface language (简体中文 / English), with
  `Accept-Language` negotiation for API responses.

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
bun install
bun run dev          # Next dev on :3000 + gateway on :4000
```

In development the UI calls the gateway directly, because Next's dev rewrite
proxy buffers SSE until the response completes. The client targets port 4000 on
the same host the page was loaded from, so both `http://localhost:3000` and
`http://<host-ip>:3000` work. Those calls are cross-origin, so `scripts/dev.ts`
seeds `RCS_WEB_CORS_ORIGINS` with the matching UI origins (localhost and the
machine's local IPv4 addresses) while preserving any origins you configured. Set
`NEXT_PUBLIC_RCS_API_URL` before `bun run dev` to point the UI at a different
gateway origin.

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
CLAUDE_CODE_INCLUDE_PARTIAL_MESSAGES=1 \
bun scripts/dev.ts remote-control
```

Run the command from this repository (or a build of it). The public npm `claude`
binary does not contain the `CLAUDE_BRIDGE_*` overrides.

- `CLAUDE_BRIDGE_BASE_URL` — public origin of this deployment.
- `CLAUDE_BRIDGE_OAUTH_TOKEN` — a per-user RCS API key. It is sent as
  `Authorization: Bearer …` on every bridge call.
- `CLAUDE_BRIDGE_SESSION_INGRESS_URL` — optional; defaults to the base URL.
  Set it explicitly only if session ingress is served from a different host.
- `CLAUDE_CODE_INCLUDE_PARTIAL_MESSAGES=1` — optional but recommended: makes the
  session child emit `stream_event` deltas, so the web UI renders text as it is
  generated instead of waiting for each complete message. Deltas are live-only;
  the gateway never persists them.
- `CLAUDE_INTERNAL_FC_OVERRIDES` — only relevant to the interactive REPL bridge
  (the `/remote-control` command): set `{"tengu_bridge_system_init":true}` to
  make it send `system/init` on connect. Standalone `remote-control` sessions do
  not need it — the session child emits `system/init` at the start of every
  turn, so the slash-command menu and the header mode control appear after the
  first message. The override only applies with `USER_TYPE=ant`.
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

## Push notifications

The UI can push a notification to the owner when a session is waiting on a
confirmation, even with the tab closed. Enable it per user under Settings.

- Web Push requires HTTPS: set `RCS_DOMAIN` so Caddy serves the site over TLS.
- To test locally, run `bun run dev` with a local certificate pair (discovered
  under `~/certificates`, or set `RCS_DEV_TLS_CERT` / `RCS_DEV_TLS_KEY`); both
  the UI and the gateway serve HTTPS. The service worker registers in dev with
  all caching disabled, so push works without shadowing dev assets.
- iOS needs 16.4+ **and** the app added to the home screen; Android and desktop
  browsers work directly.
- The gateway needs outbound access to the browser push services
  (`fcm.googleapis.com`, Apple's push endpoint, `updates.push.services.mozilla.com`).
- VAPID keys are generated on first boot and stored in Postgres. Override them
  with `RCS_VAPID_PUBLIC_KEY` / `RCS_VAPID_PRIVATE_KEY` (and optionally
  `RCS_VAPID_SUBJECT`) in `.env`. Setting a different key pair than the one
  existing subscriptions were created with invalidates those subscriptions, so
  affected browsers must re-subscribe.
- `RCS_VAPID_SUBJECT` defaults to `mailto:noreply@example.com`; set it to a
  contact address you own. Apple's push service rejects subjects whose domain
  has no public TLD (for example `mailto:noreply@localhost`) with
  `403 BadJwtToken`, breaking iOS notifications.

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
   CLAUDE_CODE_INCLUDE_PARTIAL_MESSAGES=1 \
   bun scripts/dev.ts remote-control
   ```

6. The environment appears in the UI. Start a session (web UI or CLI), open it in
   the dashboard, and confirm messages stream live (SSE) and the session history
   survives a reload (durable events).
