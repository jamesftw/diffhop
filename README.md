# diffhop

A Chrome extension (MV3) that redirects GitHub diff URLs to
[DiffsHub](https://diffshub.com). Public repos work out of the box; **private
repos work after a one-time, read-only GitHub sign-in**, no proxy and no
terminal.

- **Public repos:** just install. Every GitHub diff page redirects to DiffsHub.
- **Private repos:** click **Sign in with GitHub** in the popup once. You
  authorize the diffhop **GitHub App** (read-only) on the repos you choose, and
  the extension then fetches private diffs from the GitHub API on your behalf.

## How it works

1. You navigate to a GitHub diff URL (pull request, commit, or compare). A
   `declarativeNetRequest` main-frame rule rewrites it to the same path on
   `diffshub.com` **at the network layer** — before GitHub is fetched, so there's
   no GitHub paint and no flash. dNR redirects are transparent (no GitHub history
   entry), so pressing Back returns to your previous page.
2. GitHub's in-page (SPA / Turbo) navigations make no main-frame request, so a
   **content script** catches those as a fallback and redirects them.
3. DiffsHub's frontend fetches the raw diff via `GET /api/diff?path=…`. When
   you're **signed in**, a content script on diffshub.com intercepts that fetch
   (it patches `window.fetch`) and asks the extension's background to serve it.
   The background calls the **GitHub REST API**
   (`api.github.com/repos/.../pulls/N` with `Accept: application/vnd.github.diff`)
   using your token, and returns the diff. The token lives in the extension and
   **never reaches DiffsHub's page**. When you're signed out, the fetch is left
   alone and public diffs resolve natively through DiffsHub.

There is **no localhost proxy** — everything runs inside the extension.

## Private repos: sign in (read-only)

1. Open the **diffhop** popup → **Sign in with GitHub**. A github.com tab opens
   with the device code **already filled in** (the extension fills it for you).
2. Click **Continue**, then **Authorize**, and pick the repositories to grant
   diffhop read access to.
3. The popup flips to **Signed in**. Private PRs/commits/compares now render.

diffhop only ever reads diffs, so it authenticates as a **GitHub App** whose
permissions are **Contents: Read-only** and **Pull requests: Read-only**. Because
the permissions live on the App, the grant is read-only by construction, you
can't accidentally give it write access, and you choose exactly which repos it
sees. (GitHub has no read-only _OAuth scope_, the `repo` scope grants write too,
which is why an App is used.) The user token is stored in the extension's
`chrome.storage`, nowhere else, and **never reaches DiffsHub's page**.

> The sign-in uses GitHub's Device Flow, so there's no client secret and no
> localhost callback. To read more repos later, grant them to the diffhop App
> from your GitHub settings. Sign out anytime from the popup.

## Getting back to GitHub (escape)

Every GitHub diff page redirects to DiffsHub, so to avoid trapping you:

- Click DiffsHub's **"View on GitHub"** link. A content script on diffshub.com
  tags that link with a `?dh-skip` query; the network-layer rule has a
  higher-priority `allow` exception for it, and the GitHub content script strips
  the marker and sets a sticky **per-tab** flag so you can keep browsing GitHub
  without bouncing back. (A query, not a hash, because hashes aren't visible to
  declarativeNetRequest.)
- Or press the browser's **Back** button. Reaching a GitHub diff page via
  Back/Forward is honored (not bounced); a fresh visit to a _new_ diff still
  redirects, so nothing silently "goes dead."
- DiffsHub can leave duplicate same-URL history entries; a guard in the DiffsHub
  content script fast-forwards Back past them to your real previous page.
- The popup's **Enabled** toggle is the global off-switch.

(Why a marker instead of the referrer? DiffsHub's link is `rel="noreferrer"`.)

## Build & install

```bash
npm install
npm run build        # → dist/
npm run build:watch  # rebuild on change
```

1. Open `chrome://extensions`, enable **Developer mode** (top-right).
2. **Load unpacked** → select the `dist/` directory.
3. Pin diffhop. Public repos work immediately; for private repos, **Sign in with
   GitHub** in the popup.

## Supported URL patterns

- `/:org/:repo/pull/:number`
- `/:org/:repo/commit/:sha`
- `/:org/:repo/compare/:base...:head` (three-dot and two-dot ranges)

A trailing `.diff`/`.patch`, PR sub-tabs (`/files`, `/commits`), query strings,
and hash fragments are all normalized to the canonical diff path.

## Develop / test

```bash
npm test                # vitest run (unit)
npm run typecheck
npm run verify:browser  # builds + drives a real browser end-to-end
```

Unit coverage: URL + API-URL mapping (`test/urls.test.ts`), dynamic rule
construction (`test/rules.test.ts`), the diff service (`test/diff-service.test.ts`),
the Device Flow auth + login decisions (`test/auth.test.ts`,
`test/login-service.test.ts`), device-code autofill (`test/device-fill.test.ts`),
storage + messages, and the popup controller (`test/popup.test.ts`).

`npm run verify:browser` (`scripts/verify.mjs`) loads the built extension into a
real browser via Playwright and checks the redirect paths (PR / commit / compare
/ `.diff`), non-diff pass-through, SPA navigation, the Enabled toggle, the full
escape flow, and Back → PR list.

> It uses Playwright's **bundled Chromium**, not your installed Chrome: since
> Chrome 137, branded Chrome ignores the `--load-extension` command-line flag.
> (Loading via `chrome://extensions` → Load unpacked is unaffected.)

## Project layout

All cross-cutting constants and testable logic live under
`extension/src/lib/`; the entry scripts (`background`, `content`, `popup`,
`device`, `diffshub*`) are thin wiring over them.

- `lib/config.ts` — single source of truth for the GitHub App client,
  endpoints, storage keys, and the escape markers
- `lib/messages.ts` — typed runtime + page-bridge message contracts
- `lib/storage.ts` — typed `chrome.storage` facade
- `lib/diff-service.ts`, `lib/login-service.ts`, `lib/device-fill.ts`,
  `lib/redirect.ts` — pure cores

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev loop and conventions, and
[SECURITY.md](SECURITY.md) for how the extension handles your GitHub token and
how to report vulnerabilities.

## License

[MIT](LICENSE) © James Andrews
