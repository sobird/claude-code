# RCS PWA Push Notifications Design

Date: 2026-11-18
Scope: `packages/rcs` (Next.js 16 App Router web UI + Hono/Bun gateway)
Status: design, pending review

## Intent

A remote-controlled Claude Code turn often stops and waits for the user: a tool
permission prompt, an `AskUserQuestion`, or an `ExitPlanMode` plan approval. The
web UI renders these as cards, but today the only out-of-view signal is a
`(n)` count in `document.title` while a tab is hidden. Users close the PWA and
walk away, so the turn stalls until they come back and look.

This design makes the PWA notify the user's devices — including when the app is
fully closed — as soon as a session starts waiting for confirmation. The user
tapped "the app is closed" as the motivating moment, so page-side
`new Notification()` is not enough: delivery must go through Web Push and the
service worker.

## Goals

- G1: Within seconds of an inbound `control_request` (`subtype: can_use_tool`)
  on any session owned by the user, every subscribed device of that user shows
  an OS notification, with the PWA closed.
- G2: Tapping the notification opens/focuses that session (`/{sessionId}`).
- G3: Works on all three targets the user named: iOS installed PWA (iOS 16.4+,
  home-screen), Android installed PWA, desktop Chrome/Edge.
- G4: Per-user opt-in/out in Settings; multiple devices per user; subscriptions
  survive gateway restarts and container redeploys.
- G5: No false alarms: web-originated control requests, control subtypes other
  than `can_use_tool` (`set_model`, `set_permission_mode`,
  `set_max_thinking_tokens`), replayed/duplicate events, and sessions with no
  owner do not notify.

## Non-goals

- Notifying on turn completion, assistant messages, or any event other than a
  confirmation request. (If wanted later it is a separate trigger, not this
  design.)
- Notification action buttons (approve/deny/allowed-once from the shade). Tap
  opens the session; acting happens in the UI.
- Per-session mute, per-trigger-type preferences, quiet hours, or digests.
  v1 is one on/off switch per account.
- Other channels: email, Telegram, ntfy, SMS, native apps.
- Push for ACP channel groups (`/acp/*`) or anything outside `sessions`.
- Delivery guarantees. Web Push is best-effort; events are not queued for
  offline devices by us (the push service handles its own retry window).
- Translating anything the CLI sends. Payload content is data, not copy.

## Anti-goals

- Client-side-only notifications (`new Notification()`) — they cannot fire when
  the PWA is closed, which is the whole point.
- A service worker polling loop or periodic background sync to fake push.
- Blocking event fan-out on a push-service round trip. Notification sending
  must never delay SSE delivery or persistence.
- Server-side rendering of localized notification copy based on
  `Accept-Language`; the payload stays locale-neutral and the service worker
  localizes.
- Storing per-session notification state. A notification is a function of one
  inbound event plus the user's subscriptions.

## Constraints and facts

- Single inbound funnel: every CLI-reported event reaches
  `publishInboundEvent()` in `src/transport/event-bus.ts` from three ingress
  call sites — bridge WebSocket (`src/transport/ws-handler.ts:344`),
  `POST /v1/sessions/:id/events` (`src/routes/v1/sessions.ts:137`), and
  `POST /v1/code/sessions/:id/worker/events` (`src/routes/v2/worker-events.ts:52`).
  It returns `null` for replayed/duplicate events, which gives us free dedupe.
- Web-originated events use `publishSessionEvent(..., 'outbound')`
  (`src/routes/web/control.ts`) and are a different path — no accidental
  triggers.
- All three confirmation kinds the UI shows arrive as `control_request` with
  `request.subtype === 'can_use_tool'`. `permission-panel.tsx` derives plain
  permission cards, `AskUserQuestionCard`, and `ExitPlanModeCard` from the same
  `pendingPermissions` list (see `handlePermissionRequest` in
  `src/lib/session-reducer.ts:627`). One trigger covers all three.
- Ownership: `sessions.owner_user_id` (nullable) plus `users.id`. A session with
  no owner has nobody to notify.
- Existing PWA plumbing: `public/manifest.webmanifest`, Serwist worker
  `src/app/sw.ts` with root scope `/`, registration in
  `src/components/shell/service-worker-registration.tsx` — **production only**.
  Default Serwist caching keeps gateway paths network-only.
- Web Push prerequisites: HTTPS (localhost excepted), a user gesture to request
  permission, iOS 16.4+ with the PWA added to the home screen. Self-hosted RCS
  gets HTTPS by setting `RCS_DOMAIN` (Caddy auto-ACME); the default plain-HTTP
  `:80` deployment cannot subscribe on real devices.
- Outbound internet is required from the gateway to the browser vendors' push
  services (FCM/Mozilla/Apple).
- i18n: `messages/{en,zh-CN}.json` catalogs; `src/__tests__/no-hardcoded-cjk.test.ts`
  forbids CJK literals anywhere under `src/`. The Serwist worker is bundled
  separately but can import the same JSON catalogs.
- No push library is installed. `bun test` drives the Hono app in-process and
  never starts the gateway entrypoint.
- Conventions: `.js` relative imports, no semicolons, single quotes, 2 spaces,
  120 columns; Drizzle migrations via `bun run db:generate`; gateway config in
  `src/config.ts` (`loadConfig` takes an explicit env for tests).

## Decisions

These were settled during design; the builder should not re-litigate them.

1. **Transport: standard Web Push (VAPID) with the `web-push` npm package on the
   gateway, displayed by the existing Serwist service worker.** No third-party
   push service, no Expo/Firebase SDK.

2. **VAPID keys: generated once at gateway startup and persisted in a new
   single-row `push_settings` table; environment variables override.** Names:
   `RCS_VAPID_PUBLIC_KEY`, `RCS_VAPID_PRIVATE_KEY`, `RCS_VAPID_SUBJECT`
   (default `mailto:noreply@localhost`). Rationale: zero-config for a
   self-hosted single-instance server and subscriptions stay valid across
   container restarts (an env-only design forces the operator to run
   `web-push generate-vapid-keys` and edit `.env`; rotating the auth secret to
   derive keys would silently invalidate every subscription). If the table is
   populated and env is also set, env wins. Persist the pair as JSON in one row
   (`id` fixed to `'default'`).

3. **Storage: new `push_subscriptions` table**, `id` uuid PK,
   `user_id` uuid FK → `users.id` ON DELETE CASCADE, `endpoint` text UNIQUE NOT
   NULL, `p256dh` text NOT NULL, `auth` text NOT NULL, `user_agent` text NULL,
   `created_at`/`updated_at` timestamps matching existing helpers. Upsert by
   `endpoint` (a subscription is unique per browser profile, not per user).
   Cap at 10 subscriptions per user and evict oldest beyond that. Add a
   `PushSubscriptionRepository` to the repo bundle (`createRepositories` and
   `createMemoryRepositories`) and to `types.ts`.

4. **Trigger predicate lives in one pure helper**
   (`isConfirmationRequest(type, payload)`): true only for
   `type === 'control_request'` and a payload whose
   `(payload.request ?? payload).subtype === 'can_use_tool'` — tolerate the flat
   shape, mirroring `handlePermissionRequest` (`session-reducer.ts:629`).
   `tool_name`/`description` are read from `payload.request`, never the top
   level. The notifier receives the persisted record.

5. **The notifier hooks the existing funnel after persistence.** A module-level
   `src/services/push-notifier.ts` exposes `initPushNotifier({ config, repos })`
   (called from `server/index.ts` next to `startDisconnectMonitor`) and
   `notifyInboundEvent(record)`. `publishInboundEvent()` calls it
   fire-and-forget (`void` with an internal catch) after a record is persisted
   and published. Until init resolves, calls await an internal ready promise
   (not silently drop); when never initialized (unit tests, `bun test` route
   tests) it is a no-op. This guarantees all three ingress paths are covered and
   cannot drift.

6. **Send path:** resolve `session.ownerUserId`; skip when null. Load that
   user's subscriptions and `Promise.allSettled` over `webPush.sendNotification`
   with a ~5s timeout. On HTTP 404/410 (or `WebPushError.statusCode` 404/410)
   delete the row; log other failures and continue. Never throw out of the
   notifier.

7. **Payload is locale-neutral** — the service worker owns copy. JSON payload:
   `{ v: 1, kind: 'permission' | 'question' | 'plan', sessionId, sessionTitle?, toolName, description?, requestId }`.
   `kind` is derived server-side from `request.tool_name`:
   `AskUserQuestion` → `question`, `ExitPlanMode` → `plan`, else `permission`.
   The worker maps `kind` to catalog strings (`notifications.*`) using
   `self.navigator.language` (zh-CN when it starts with `zh`, else en).

8. **Notification behavior in the worker:** `tag` is
   `session:{sessionId}:{requestId}` so a resend replaces rather than stacks;
   `data.url` is `/{sessionId}`; `renotify` stays off. Before showing, the
   worker calls `clients.matchAll({ type: 'window', includeUncontrolled: true })`
   and skips the notification when a **visible** client is already on that
   session's path (the panel is on screen). This is the one suppression rule.
   `notificationclick` focuses a matching client (matching pathname) or calls
   `clients.openWindow(url)`.

9. **Client surface: a "Notifications" card in Settings.** State machine:
   unsupported (no `serviceWorker`/`PushManager`/`Notification`), iOS but not
   standalone (show install-to-home-screen guidance, reuse the existing install
   prompt copy), permission denied (explain how to re-enable), subscribed,
   available. Enable = request permission → `registration.pushManager.subscribe({
userVisibleOnly: true, applicationServerKey })` → `POST /web/push/subscriptions`.
   Disable = `subscription.unsubscribe()` → `DELETE` the row. On every mount
   with permission already granted, reconcile any existing subscription by
   re-upserting it (covers endpoint rotation and multi-tab idempotency).

10. **Gateway endpoints under `/web/push/*`, all `legacyUserAuth`-protected and
    CORS'd like the rest of `/web`:**
    - `GET /web/push/config` → `{ enabled: boolean, publicKey: string | null }`
      (`enabled` false when no usable key pair).
    - `POST /web/push/subscriptions` with
      `{ endpoint, keys: { p256dh, auth } }` → 204, upsert for `c.get('user').id`.
    - `DELETE /web/push/subscriptions?endpoint=…` → 204. (The client
      `api-client.delete` helper has no body parameter; a query param keeps it
      unchanged. URL-encode the value, and require an exact match on the
      caller's own row.)

11. **Settings copy and notification copy live in catalogs** under
    `settings.notifications.*` and `notifications.*`. No CJK literals in `src/`.

12. **Dependency:** add `web-push` (runtime) and `@types/web-push` (dev).
    Verify `bun run build:gateway` bundles it with Node built-ins under Bun
    before relying on it; if the bundle is unhappy, load it with a dynamic
    `import()` inside the notifier, mirroring how the repo defers heavy
    vendors. (Bundling under Bun is unverified; the fallback is pre-approved.)

13. **Docs:** README (Docker/deploy) gets the HTTPS/iOS requirements note and
    the VAPID env overrides; `docs/environment-variables.md` lists the three
    variables.

## Work outline (for the plan)

1. Migration + schema: `push_settings`, `push_subscriptions`; repository and
   memory repository; repo bundle wiring; repo tests (upsert by endpoint,
   per-user cap, cascade on user delete).
2. `src/services/push-notifier.ts`: VAPID bootstrap/persist, `isConfirmationRequest`,
   payload builder, send loop with 404/410 cleanup, module init. Unit tests with
   an injected fake sender.
3. Hook `publishInboundEvent`; initialize in `server/index.ts`; config fields in
   `src/config.ts`.
4. Gateway routes `src/routes/web/push.ts` + route tests (auth, validation,
   config when unconfigured).
5. Service worker: `push` + `notificationclick` handlers, catalog import,
   message helper; unit-test the pure payload→notification mapping. Extend the
   existing `declare const self` block in `src/app/sw.ts` (`addEventListener`,
   `registration`, `clients`, `navigator`) and declare local `PushEvent` /
   `NotificationEvent` shapes — the project's DOM lib lacks the webworker ones.
6. Settings UI: notifications card + client hook; iOS/unsupported/denied states;
   `useSettingsApi`-based token wiring.
7. i18n keys in both catalogs; run `bun run fmt`, `typecheck`, targeted tests.
8. Manual verification on desktop Chrome and the user's phone (iOS and/or
   Android) per the risk list below.

## Risks and manual verification

- **iOS**: install-to-home-screen, iOS 16.4+, user gesture, and push only after
  the first subscribe. Must be verified on a real device; Safari desktop cannot
  stand in.
- **HTTPS**: a plain-HTTP deployment silently cannot subscribe (SecureContext).
  The Settings card must state this rather than fail obscurely.
- **Push service reachability** from a restrictive network (e.g. mainland
  China to FCM) can delay or drop delivery for Android/Chrome. Not fixable
  here; document it.
- **Duplicate devices**: one browser profile = one subscription; multiple
  profiles/devices legitimately receive multiple notifications.
- **Service worker only registers in production**: push cannot be tested with
  `bun run dev:web`; use a production build/preview.
- **LLM-generated `sessionTitle`** may be long; truncate in the worker (~60
  chars) before showing.

## What is left to the builder

- Exact `web-push` version and whether `@types/web-push` is still needed for
  the installed version.
- Whether to coalesce several pending requests in one session into a single
  notification (default: no; each request gets its own tag).
- The per-user subscription cap (default 10) and eviction order.
- Default VAPID subject value and whether to log the generated public key at
  first boot.
- Whether `pushsubscriptionchange` should be handled in the worker now or left
  to the mount-time reconcile (recommended: mount-time reconcile now; handler
  as a follow-up).

## Resolved during design

- **Deployment is HTTPS** (Caddy `RCS_DOMAIN`), confirmed 2026-11-18. Web Push
  is viable on all three targets. The Settings card still detects and explains
  insecure contexts instead of failing obscurely, because a future plain-HTTP
  deployment is possible.
- iOS verification (home screen install, iOS 16.4+) is a manual test step, not
  a design dependency.
