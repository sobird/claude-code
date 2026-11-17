# RCS Internationalization Design

Date: 2026-11-17
Scope: `packages/rcs` (Next.js 16 App Router web UI + Hono gateway)

## Intent

RCS users should be able to pick their own language. First release supports
Simplified Chinese (`zh-CN`) and English (`en`). Adding a language later should
be adding a catalog file and a registry entry, not touching pages.

Today the web UI mixes hardcoded English (most of the app) with hardcoded
Chinese (chat components), and there is no per-user preference storage.

## Goals

- Every user-visible string in the web UI comes from a message catalog.
- A logged-in user can switch language in Settings; the choice persists per
  account (and mirrors to a cookie so server rendering matches on first paint).
- Anonymous pages (login) follow the browser language.
- Dates, times, and relative times format with the active locale.
- Adding a third locale later costs: one catalog file + one registry entry +
  a translation pass (no page logic changes).

## Non-goals (phase 1)

- Translating model output. The model speaks whatever the user wants.
- Translating the terminal CLI (including protocol text such as
  `Permission denied by user` that flows back to the SDK/bridge).
- Translating gateway text consumed by CLI/worker API clients (`v1`, `v2`,
  `acp` route families). Those stay English: they are protocol strings, not UI.
- Server logs, stack traces, developer docs, README.
- Translating already-stored session titles ("New Session" created earlier).
- URL-prefixed locales (`/en/...`). This is an authenticated single app with a
  `basePath`, PWA service worker, and offline routes; prefix routing would churn
  all of that for no user-visible gain.

## Anti-goals

- Server responses that vary by `Accept-Language`. JSON error payloads stay
  stable; localization happens in the UI from stable codes.
- Writing locale checks inside individual pages/components. Resolution lives in
  one place.
- Storing translated strings in the database as the source of truth.

## Constraints

- Next.js 16.4 (`app/` router), React 19, `basePath: /code`.
- Auth.js v5 (next-auth beta) with an Edge middleware (`src/middleware.ts`) that
  cannot reach the database.
- PWA: serwist service worker, precached `~offline` page, static
  `public/manifest.webmanifest`.
- Tests run with `bun test`; several tests pin English copy today.
- No i18n library is installed.

## Decisions

These were decided during design; the builder should not re-litigate them.

1. **Library: `next-intl`** (JSON catalogs + ICU messages). It supports App
   Router server components and client components, cookie-based locale without
   URL routing, and ICU plural/interpolation. Verify the installed version's
   peer range covers Next 16 before committing to it; if it does not, fall back
   to a small in-repo dictionary helper with the same catalog shape. Do not
   switch to `.po`/gettext.

2. **No locale in the URL.** Locale comes from a `rcs_locale` cookie for
   rendering, backfilled from the user's stored preference.

3. **Resolution order (one helper, `resolveLocale`)**: explicit user preference
   (cookie) → browser `Accept-Language` (supported locales only) → `zh-CN`.
   The DB value is copied into the cookie at login and whenever the user changes
   the setting, so server rendering only needs the cookie.

4. **Storage: `users.locale text` nullable, no default, no DB check
   constraint.** `NULL` means "never chose" (fall through to browser). The API
   validates against the supported-locale list, so adding a language is a code
   change only, not a migration.

5. **Catalogs:** `packages/rcs/messages/zh-CN.json` and
   `packages/rcs/messages/en.json`, namespaced by area: `common`, `auth`,
   `dashboard`, `session`, `chat`, `settings`, `admin`, `offline`, `errors`.
   Code references keys only. Tests assert keys/behaviour, not prose.

6. **Client provider:** the locale-aware root layouts (see decision 13) resolve
   the locale server-side, set `<html lang>` accordingly, and wrap children in
   the next-intl provider with the active catalog so the 24 `'use client'`
   components can translate.

7. **Server-generated user-visible errors**: add a stable `code` to
   Web-facing error responses alongside the existing message (see decision 15
   for the exact shape). The web client maps `code` → catalog text and falls
   back to the raw message for unknown codes. CLI/worker-facing routes are
   untouched.

8. **Stored defaults localized at creation time — Web routes only.** Defaults
   created from the web app ("New Session" via `/web/sessions`, "API key" via
   `/web/account`) resolve the locale from the request's `Accept-Language`
   (browsers send it on same-origin fetches) using a tiny locale→title map shared
   with the web catalogs. Defaults created by CLI/worker routes (`/v1`, ACP
   "ACP Agent") stay English — those callers have no browser locale. Once
   stored, titles are user data and are never re-translated.

9. **Status words are UI concerns:** raw statuses (`idle`, `archived`, `online`,
   `offline`, …) keep their wire values; the UI maps them to labels. Same for
   reducer fallbacks (`tool`, `unknown`, `Unknown error`).

10. **Dates/times** use `Intl` with the active locale via one formatting helper;
    replace existing `toLocaleString()`/`toLocaleDateString()` calls and the
    literal `Never`.

11. **Settings surface — the Next server owns the cookie.** A language selector
    in Settings calls a new same-origin Next route handler
    (`POST /code/api/preferences` with `{ locale }`). That handler validates the
    locale, writes `users.locale` through the shared Drizzle repositories, and
    sets `rcs_locale` on its own response. It does not go through the gateway, so
    split-host dev (UI on :3000 calling the gateway on :4000) needs no CORS or
    credentials changes. The client then refreshes so server components re-render.

12. **Login/sign-out cookie lifecycle.** The login server action, after a
    successful `signIn`, reads the user's stored locale and either sets
    `rcs_locale` or deletes it when the user has none (so browser language
    applies). The sign-out action deletes `rcs_locale`. The Edge middleware and
    the JWT stay untouched: no locale claim, no DB access there.

13. **App structure: per-area root layouts.** The root `app/layout.tsx` does not
    read cookies. Route groups (`(main)` for dashboard/chat/settings/admin,
    `(auth)` for login, plus the offline page) each get their own root layout.
    `(main)` and `(auth)` resolve the locale and set `<html lang>` + the
    next-intl provider; the offline root layout stays static so `~offline`
    remains precachable by the service worker. Shared markup/theme script lives
    in one `RootShell` component used by all root layouts.

14. **Offline page and manifest:** the manifest stays static English (app name).
    The offline page is precached and renders a bilingual static message; it is
    not locale-switched. Revisit only if it matters.

15. **Error `code` shape:** flat Web errors become `{ error: string, code: string }`;
    the nested `jsonError` helper gains an optional `code` that is only passed by
    Web callers (`error.code`). `v1`/`v2`/`acp` responses stay byte-identical
    (the helper emits no `code` unless given one). The web client reads
    `code ?? error.type`, maps to catalog text, and falls back to the message.

## Work outline (for the plan)

1. Scaffold next-intl (or fallback helper), locale registry, `resolveLocale`,
   cookie handling, the per-area root layout split, and the provider.
2. Add `users.locale` migration + `POST /api/preferences` + Settings language
   selector, including login backfill and sign-out clearing.
3. Extract strings area by area into catalogs, starting with shared shell/login,
   then dashboard/session/chat, then settings/admin/offline.
4. Add Web-facing error `code`s where the UI displays server messages; map them.
5. Formatters for dates/times.
6. Localize creation-time defaults.
7. Update tests that pin English copy; add tests for locale resolution, the
   preferences endpoint, and cookie behaviour.

## What is left to the builder

- Choose the exact next-intl version and confirm Next 16 compatibility (or use
  the fallback helper).
- Catalog key naming and namespace granularity within the areas above.
- The concrete API contract details of `POST /api/preferences` (error codes,
  response shape) consistent with existing Next route handlers.
- Which existing English test assertions become key assertions vs. keep as
  wire-protocol assertions.
- Whether to add an automated guard (lint/check script) against new hardcoded
  UI literals.
