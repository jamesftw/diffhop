# CLAUDE.md

## What this is

**diffhop** — a Chrome MV3 extension that redirects GitHub diff URLs to
[DiffsHub](https://diffshub.com), with private-repo support handled **entirely
in-browser** (no localhost proxy, no token to paste). Public repos work on
install; private repos work after a one-click, **read-only** "Sign in with
GitHub" in the popup.

Repo: `git@github.com:JamesFTW/diffhop.git` · folder: `~/code/diffhop`
Open PR: **#2** (`refactor/oss-readiness-and-readonly-auth` → `main`).

## Commands

```bash
npm install
npm run build           # esbuild → dist/ (the unpacked extension)
npm run build:watch
npm test                # vitest, unit (90 tests)
npm run typecheck       # tsc --noEmit
npm run format          # prettier --write .  (semicolon-free, single quotes)
npm run format:check    # CI fails on unformatted files
npm run verify:browser  # builds + Playwright drives a real browser (public-path checks)
```

Load `dist/` via `chrome://extensions` → Developer mode → Load unpacked.
**After any rebuild you must hit ↻ reload on the extension card** — an unpacked
extension does not auto-update, and content scripts on already-open tabs stay
stale until you refresh those tabs too.

CI (`.github/workflows/ci.yml`) runs format check, typecheck, tests, and build.

## Architecture

TypeScript in `extension/src/`, bundled to `dist/` as IIFE by `build.mjs`.
Cross-cutting, testable logic lives in **`extension/src/lib/`**; the entry
scripts are thin chrome/DOM wiring over it.

### `lib/` (pure-ish, unit-tested)

- **`config.ts`** — single source of truth for every constant: the GitHub App
  client ID, endpoints/origins, storage keys, `APP_INSTALL_URL`, poll cadence,
  the `dh-skip` escape markers. Storage-key _values_ are persisted; never rename.
- **`messages.ts`** — typed message contracts (discriminated unions) for runtime
  messages (`fetchDiff` / `login` / `pollNow` / `signout`) and the MAIN↔isolated
  bridge, plus `isRuntimeMessage` / `isBridgeMessage` guards.
- **`storage.ts`** — typed `chrome.storage` facade (config, token, device,
  needs-access) + change subscriptions.
- **`diff-service.ts`** — `fetchDiff(url, deps)`: the diff-serving core, deps
  injected (`isEnabled`, `getToken`, `fetch`) so it tests without chrome.
- **`login-service.ts`** — `buildDeviceState`, `decidePollOutcome` (pure).
- **`device-fill.ts`** — `selectUserCode`, `findCodeFields`, `fillCode`: the
  device-code autofill logic (GitHub renders the code as **nine single-char
  boxes**, `js-user-code-field`, index 4 a readonly dash).
- **`redirect.ts`** — `decideRedirect`: pure "redirect to DiffsHub or stay" policy.
- **`runtime.ts`** — `extensionAlive()`: guards content scripts against a dead
  chrome handle after an extension reload.
- **`urls.ts`** — `matchGitHubDiffUrl`, `toDiffsHubUrl`, `toApiUrl`.
- **`rules.ts`** — `buildDynamicRules`: the declarativeNetRequest rules.

### Entry scripts (thin wiring)

- **`background.ts`** — service worker. Syncs dNR rules to `enabled`; runs the
  Device Flow login; `pollTick` polls the token endpoint; routes messages;
  `signalAccess` badges the icon + sets the needs-access flag on a 404.
- **`auth.ts`** — Device Flow primitives (`requestDeviceCode`, `pollOnce`). No
  scope (a GitHub App defines its own permissions).
- **`content.ts`** — github.com redirect fallback for in-page (SPA/Turbo) navs;
  honors Back/Forward + the `?dh-skip` escape.
- **`device.ts`** — github.com/login/device: autofills the activation code.
- **`diffshub.ts`** — diffshub.com (isolated world): bridges the MAIN-world fetch
  patch to the background; tags "View on GitHub" links; dedupes Back history.
- **`diffshub-main.ts`** — diffshub.com (**MAIN world**): monkey-patches
  `window.fetch` so DiffsHub's `/api/diff` call is served by the extension.
- **`popup.ts` / `popup.html` / `popup.css`** — Enabled toggle, sign-in, "Choose
  repositories" link, needs-access hint. Logic injected (jsdom-testable).

### Sign-in: read-only GitHub App (Device Flow)

- Authenticates as a **GitHub App** (Client ID `Iv23lilMGOrtYO1NhKlZ`, owned by
  an org, installable on any account), **not** an OAuth App. Permissions are
  Contents: read + Pull requests: read — read-only by construction, no scope sent.
- The App must be **installed** on a repo to read it; a user-to-server token
  404s otherwise. On a 404, `signalAccess` sets a `!` badge + the needs-access
  flag, and the popup shows a "Choose repositories" link to `APP_INSTALL_URL`.
- **Fast pickup:** the popup polls (`pollNow`) immediately on open and every 5s
  while open and pending; `chrome.alarms` is the closed-popup backstop. Do not
  rely on a service-worker `setInterval` — it doesn't keep the worker alive.

### How a private diff renders (the key flow)

1. github diff URL → dNR redirect → `diffshub.com/<path>`.
2. DiffsHub's page calls `fetch('/api/diff?path=…')`.
3. `diffshub-main.ts` (MAIN world) has monkey-patched `window.fetch`, so it
   catches that call before it leaves the browser and postMessages it to
   `diffshub.ts` (isolated), which `sendMessage`s the background.
4. `background.ts` → `fetchDiff` calls `api.github.com/.../pulls/N` with
   `Accept: application/vnd.github.diff` + the user's token, and the diff text is
   handed back through the chain to **resolve the original `fetch`**.
5. DiffsHub's own viewer renders that text. The endpoint is never hit; the token
   lives in `chrome.storage.local` and **never reaches the page**. Signed out or
   public → the patch declines and the real fetch hits DiffsHub's backend.

### Storage keys

- `chrome.storage.sync` `diffshub-config` = `{ enabled: boolean }`
- `chrome.storage.local` `diffshub-token` = the GitHub user token (`ghu_…`)
- `chrome.storage.local` `diffshub-device` = in-progress device login (lets the
  popup re-show the code after it closes)
- `chrome.storage.local` `diffshub-needs-access` = set when a diff 404'd

## Hard-won gotchas (don't relearn these)

- **Pass `fetch` bound to its global `this`.** `fetchDiff` takes an injected
  `fetch`; passing it bare and calling `deps.fetch(...)` throws "Illegal
  invocation" in the worker. Use `fetch.bind(globalThis)`. (Mock-based tests
  don't catch this — only a real browser run does.)
- **`chrome.alarms` is clamped to ~30s**, far too slow for sign-in, so the popup
  drives fast polling instead (see Sign-in above).
- **MV3 `setInterval` doesn't keep the service worker alive**, and the worker is
  terminated on idle, so a worker-side poll loop silently dies.
- **Extension reload invalidates content scripts' chrome handle** ("Extension
  context invalidated"); guard chrome calls with `extensionAlive()`.
- **GitHub App user tokens only see installed repos** (404 otherwise) — hence the
  install link + needs-access nudge.
- **GitHub's device page is nine single-char boxes** (`js-user-code-field`), not
  one field; index 4 is a readonly dash. `device-fill.ts` fills the eight.
- **Branded Chrome 137+ ignores `--load-extension`.** The verify script uses
  Playwright's **bundled Chromium** (no `channel`), which still honors it.
- **dNR `regexFilter` has a ~2KB compiled budget**; an over-complex regex is
  silently rejected and fails the whole `updateDynamicRules` batch.
- **GitHub's web `.diff` endpoint ignores token auth for private repos** (404) —
  must use the REST API + `Accept: application/vnd.github.diff`.
- **DiffsHub's `/api/diff` path is percent-encoded** (`%2F…`); a dNR
  `regexSubstitution` can't URL-decode, which is why we use background-fetch.
- **DiffsHub's "View on GitHub" link is `rel="noreferrer"` + `target=_blank`**,
  so the `?dh-skip` query marker does escape detection (not the referrer).
- **MV3 popups close on focus loss**, so the device tab hides the code — hence
  persisting it in `diffshub-device` and re-showing on reopen.

## Conventions

- **Prettier, semicolon-free, single quotes** (`.prettierrc.json`); run
  `npm run format`. CI enforces `format:check`. No em dashes in code/comments.
- **TDD for `lib/`** — pure logic tested first (`test/`, importing from
  `extension/src/`). Entry-script glue is covered by `npm run verify:browser`.
- **Keep entry scripts thin**; logic worth testing goes in `lib/` as a pure
  function with injected deps.
- New content scripts must be added to **both** `build.mjs` and `manifest.json`.
- Comments are tight: explain the non-obvious _why_, don't restate the code.
- Commits: no Claude attribution.

## Notes

- A localhost-proxy implementation existed earlier and was removed for the
  in-browser approach. Don't reintroduce it. `~/.diffhop/token.json` and any
  `.env` are orphaned leftovers (the verify script no longer reads the token).
- OSS scaffolding is in place: `LICENSE` (MIT), `CONTRIBUTING.md`, `SECURITY.md`.
