# diffhop

A Chrome extension (MV3) that redirects GitHub diff URLs to
[DiffsHub](https://diffshub.com), plus a minimal localhost proxy that adds
**private-repo support** by authenticating DiffsHub's diff fetches against
GitHub with your own Personal Access Token (PAT).

- **Public repos:** work with the extension alone — no proxy, no token.
- **Private repos:** run the localhost proxy with a PAT. The extension redirects
  DiffsHub's `/api/diff` calls to the proxy, which fetches the diff from GitHub
  authenticated and hands it back.

## How it works

1. You navigate to a GitHub diff URL (pull request, commit, or compare). A
   `declarativeNetRequest` main-frame rule rewrites it to the same path on
   `diffshub.com` **at the network layer** — before GitHub is fetched, so there's
   no GitHub paint and no flash. Because dNR redirects are transparent (they
   leave no GitHub history entry), pressing Back returns to your previous page.
2. GitHub's in-page (SPA / Turbo) navigations make no main-frame request, so a
   **content script** catches those as a fallback and redirects them.
3. DiffsHub's frontend fetches the raw diff via
   `GET https://diffshub.com/api/diff?path=…`.
4. **If a PAT is configured**, another `declarativeNetRequest` rule redirects
   that fetch to `http://localhost:<port>/api/diff?…`. The proxy fetches
   `https://github.com{path}.diff` with `Authorization: Bearer <PAT>` and
   returns the diff with the CORS header DiffsHub's page requires.
5. **If no PAT is configured**, the `/api/diff` request is left untouched and
   public diffs resolve natively through DiffsHub.

## Getting back to GitHub (escape)

Every GitHub diff page redirects to DiffsHub, so to avoid trapping you:

- Click DiffsHub's **"View on GitHub"** link. A content script on diffshub.com
  tags that link with a `?dh-skip` query; the network-layer rule has a
  higher-priority `allow` exception for it, and the GitHub content script strips
  the marker and sets a sticky **per-tab** flag so you can keep browsing GitHub
  via in-page navigation without bouncing back. (A query, not a hash, because
  hashes aren't visible to declarativeNetRequest.)
- Or just press the browser's **Back** button. Reaching a GitHub diff page via
  Back/Forward is honored (not bounced) — but a fresh visit to a *new* diff
  still redirects, so nothing silently "goes dead."
- DiffsHub can leave duplicate same-URL history entries when you arrive via the
  redirect, which would otherwise make Back cycle between identical DiffsHub
  pages. A guard in the DiffsHub content script fast-forwards Back past those
  duplicates so you reach your real previous page (e.g. the PR list).
- The popup's **Enabled** toggle remains the global off-switch.

(Why a marker instead of the referrer? DiffsHub's link is `rel="noreferrer"`, so
no referrer reaches GitHub to detect.)

## Build

```bash
npm install
npm run build        # → dist/ (extension) and proxy/dist/server.js (proxy)
npm run build:watch  # rebuild extension + proxy on change
```

## Install the extension (unpacked)

1. `npm run build`
2. Open `chrome://extensions`, enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the `dist/` directory.
4. Pin the extension and open its popup to configure:
   - **Enabled** — master on/off toggle.
   - **Proxy port** — must match the proxy's port (default `7547`).
   - **Use local proxy** — turn on for private repos (after starting the proxy).


## Private repos: log in & run the proxy

No manual token generation — authenticate with GitHub's Device Flow:

1. **Log in** (one time):
   ```bash
   npm run login
   ```
   It prints a code and a link (`github.com/login/device`). Open the link, enter
   the code, click **Authorize**. The token is saved to `~/.diffhop/token.json`.
2. **Start the proxy** and leave it running while browsing private diffs:
   ```bash
   npm start          # builds, then runs node proxy/dist/server.js (port 7547)
   ```
3. In the extension popup, turn on **Use local proxy** (and make sure **Proxy
   port** matches).

That's it — private PRs/commits/compares now render in DiffsHub.

The login uses a public OAuth App Client ID (no secret); the token is a normal
GitHub user token stored only on your machine. To re-authenticate, run
`npm run login` again.

**Manual PAT fallback:** instead of `npm run login`, you can put a token in
`.env` (`GITHUB_PAT=…`, classic `repo` scope or fine-grained Contents:read). The
proxy prefers the Device Flow token and falls back to `.env`.

## Supported URL patterns

The extension redirects (and the proxy serves) these GitHub diff routes:

- `/:org/:repo/pull/:number`
- `/:org/:repo/commit/:sha`
- `/:org/:repo/compare/:base...:head` (three-dot and two-dot ranges)

A trailing `.diff`/`.patch`, PR sub-tabs (`/files`, `/commits`), query strings,
and hash fragments are all normalized to the canonical diff path.

## Develop / test

```bash
npm test              # vitest run (unit)
npm run test:watch
npm run typecheck
npm run verify:browser  # builds + drives a real browser end-to-end
```

Unit coverage: URL matching (`test/urls.test.ts`), dynamic rule construction
(`test/rules.test.ts`), the proxy request handler incl. CORS/preflight/error
passthrough (`test/server.test.ts`), and the popup controller incl.
double-submit guard and keyboard submit (`test/popup.test.ts`).

`npm run verify:browser` (`scripts/verify.mjs`) loads the built extension into a
real browser via Playwright and checks the redirect paths (PR / commit / compare
/ `.diff`), the non-diff pass-through, SPA navigation, the Enabled toggle, and
the full escape flow (DiffsHub link tagging → marker escape → sticky per tab).

> It uses Playwright's **bundled Chromium**, not your installed Chrome: since
> Chrome 137, branded Chrome ignores the `--load-extension` command-line flag,
> so command-line automation can't load the extension there. (Loading it
> manually via `chrome://extensions` → Load unpacked is unaffected.)

## Private-repo proxy testing in production

Beyond mocked unit tests, exercise the proxy against the real service: start it
with a valid PAT and confirm a private PR renders in DiffsHub, and that a wrong
PAT surfaces GitHub's 401/404 naturally.
