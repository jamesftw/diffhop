# CLAUDE.md

## What this is

**diffhop** — a Chrome MV3 extension that redirects GitHub diff URLs to
[DiffsHub](https://diffshub.com), with private-repo support handled **entirely
in-browser** (no localhost proxy, no token to paste). Public repos work on
install; private repos work after a one-click "Sign in with GitHub" in the popup.

Repo: `git@github.com:JamesFTW/diffhop.git` · folder: `~/code/diffhop`
Open PR: **#1** (`initial-implementation` → `main`).

## Commands

```bash
npm install
npm run build           # esbuild → dist/ (the unpacked extension)
npm run build:watch
npm test                # vitest, unit (42 tests)
npm run typecheck       # tsc --noEmit
npm run verify:browser  # builds + Playwright drives a real browser (13 checks)
```

Load `dist/` via `chrome://extensions` → Developer mode → Load unpacked.
**After any rebuild you must hit ↻ reload on the extension card** — an unpacked
extension does not auto-update.

## Architecture

All code is in `extension/src/` (TypeScript, bundled to `dist/` as IIFE).

- **`urls.ts`** — pure logic. `matchGitHubDiffUrl` (pull/commit/compare incl.
  `.diff`/`.patch`, sub-tabs, query/hash → canonical path), `toDiffsHubUrl`,
  `toApiUrl` (page path → `api.github.com/repos/.../{pulls,commits,compare}`).
- **`rules.ts`** — `buildDynamicRules`: the declarativeNetRequest rules. A
  main-frame **redirect** (github diff → diffshub, network-layer = no flash,
  transparent so Back works) + a higher-priority **allow** rule exempting the
  `?dh-skip` escape marker.
- **`background.ts`** — service worker. Syncs dNR rules to the `enabled` flag;
  runs the **Device Flow** login (alarm-based polling, survives SW shutdown);
  handles `fetchDiff` messages by calling the GitHub REST API with the token.
- **`auth.ts`** — Device Flow primitives (`requestDeviceCode`, `pollOnce`) +
  the public OAuth App Client ID `Ov23liODx8sAMhf2l7Ma`.
- **`content.ts`** — github.com content script: fallback redirector for in-page
  (SPA/Turbo) navigations the dNR rule can't see; honors Back/Forward + the
  `?dh-skip` escape (strips it, sets a sticky per-tab flag).
- **`diffshub.ts`** — diffshub.com content script (isolated world): bridges the
  MAIN-world fetch patch to the background; tags "View on GitHub" links with
  `?dh-skip`; fast-forwards Back past DiffsHub's duplicate history entries.
- **`diffshub-main.ts`** — diffshub.com content script (**MAIN world**): patches
  `window.fetch` so DiffsHub's `/api/diff` call is served by the extension.
- **`popup.ts` / `popup.html` / `popup.css`** — Enabled toggle + "Sign in with
  GitHub" button. Logic is injected (jsdom-testable).
- **`escape.ts`** — shared `SKIP_PARAM = 'dh-skip'`, `SKIP_FLAG`.

### How a private diff renders (the key flow)
1. github diff URL → dNR redirect → `diffshub.com/<path>`.
2. DiffsHub's page calls `fetch('/api/diff?path=…')`.
3. `diffshub-main.ts` (MAIN world) intercepts that fetch, postMessages it to
   `diffshub.ts` (isolated world), which `sendMessage`s the background.
4. `background.ts#fetchDiff` calls `api.github.com/.../pulls/N` with
   `Accept: application/vnd.github.diff` + `Authorization: Bearer <token>`,
   returns the diff text back through the chain as the fetch Response.
5. Token lives in `chrome.storage.local`; it **never reaches DiffsHub's page**.
   Signed out → fetch is left alone, public diffs resolve natively.

### Storage keys
- `chrome.storage.sync` `diffshub-config` = `{ enabled: boolean }`
- `chrome.storage.local` `diffshub-token` = the GitHub token
- `chrome.storage.local` `diffshub-device` = in-progress device login (so the
  popup can re-show the code after it closes)

## Hard-won gotchas (don't relearn these)

- **Branded Chrome 137+ ignores `--load-extension`** from the command line. The
  Playwright verify script uses **bundled Chromium** (no `channel: 'chrome'`),
  which still honors it. Manual "Load unpacked" is unaffected.
- **dNR `regexFilter` has a ~2KB compiled-size budget.** An over-complex regex
  is silently rejected AND fails the whole `updateDynamicRules` batch. Keep
  rule regexes small.
- **GitHub's web `.diff` endpoint ignores PAT auth for private repos** (404).
  Must use the REST API + `Accept: application/vnd.github.diff`.
- **DiffsHub's `/api/diff` path arrives percent-encoded** (`%2F…`). A dNR
  `regexSubstitution` can't URL-decode, which is why redirecting the fetch
  straight to the API at the network layer was infeasible → we use the
  background-fetch approach instead.
- **DiffsHub's "View on GitHub" link is `rel="noreferrer"`** and `target=
  "_blank"`, so referrer-based escape detection doesn't work → the `?dh-skip`
  query marker does.
- **MV3 popups close on focus loss**, so opening the device tab hides the code.
  Hence persisting the code in `diffshub-device` and re-showing it on reopen.

## Conventions

- TDD for pure logic (urls, rules, auth) — test first. Tests in `test/`,
  importing from `extension/src/`. Glue (content scripts, SW wiring) is verified
  via `npm run verify:browser`, not unit-tested.
- esbuild bundles each entry in `build.mjs`; new content scripts must be added
  there AND in `manifest.json`.
- Commits: no Claude attribution (set in `~/.claude/settings.json`).

## Open follow-ups (next iteration)

1. **Device-flow code auto-fill doesn't work** — `github.com/login/device?user_code=…`
   does not pre-fill the boxes; today the popup re-shows the code as a fallback.
   Find a smoother authorize hand-off.
2. **Least privilege** — sign-in requests the classic OAuth `repo` scope (full
   repo access). Switch to a GitHub App / fine-grained per-repo read-only
   (Contents:read) so reading a diff doesn't need full access.

## Notes

- A localhost-proxy implementation existed earlier and was **removed** in favor
  of the in-browser approach (see the "Go proxy-free" commit). Don't reintroduce
  it. `~/.diffhop/token.json` and any `.env` are orphaned leftovers from that era.
