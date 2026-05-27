# diffhop

A Chrome extension (MV3) that redirects GitHub diff URLs to [DiffsHub](https://diffshub.com). Public repos work out of the box. Private repos work after a one-time, read-only GitHub sign-in.

- **Public repos:** install and go. Every GitHub diff page redirects to DiffsHub.
- **Private repos:** click **Sign in with GitHub** in the popup once. You authorize the diffhop GitHub App (read-only) on the repos you choose, and the extension fetches private diffs from the GitHub API on your behalf.

## Build and install

```bash
npm install
npm run build        # → dist/
npm run build:watch  # rebuild on change
```

1. Open `chrome://extensions`, enable **Developer mode** (top-right).
2. **Load unpacked**, then select the `dist/` directory.
3. Pin diffhop. Public repos work immediately. For private repos, **Sign in with GitHub** in the popup.

## Supported URL patterns

- `/:org/:repo/pull/:number`
- `/:org/:repo/commit/:sha`
- `/:org/:repo/compare/:base...:head` (three-dot and two-dot ranges)

A trailing `.diff`/`.patch`, PR sub-tabs (`/files`, `/commits`), query strings, and hash fragments are all normalized to the canonical diff path.

## Develop and test

```bash
npm test                # vitest run (unit)
npm run typecheck
npm run verify:browser  # builds + drives a real browser end-to-end
```

Unit coverage: URL + API-URL mapping (`test/urls.test.ts`), dynamic rule construction (`test/rules.test.ts`), the diff service (`test/diff-service.test.ts`), the Device Flow auth + login decisions (`test/auth.test.ts`, `test/login-service.test.ts`), device-code autofill (`test/device-fill.test.ts`), storage + messages, and the popup controller (`test/popup.test.ts`).

`npm run verify:browser` (`scripts/verify.mjs`) loads the built extension into a real browser via Playwright and checks the redirect paths (PR / commit / compare / `.diff`), non-diff pass-through, SPA navigation, the Enabled toggle, the full escape flow, and Back → PR list.

> It uses Playwright's bundled Chromium, not your installed Chrome. Since Chrome 137, branded Chrome ignores the `--load-extension` command-line flag. (Loading via `chrome://extensions` → Load unpacked is unaffected.)

## Project layout

All cross-cutting constants and testable logic live under `extension/src/lib/`. The entry scripts (`background`, `content`, `popup`, `device`, `diffshub*`) are thin wiring over them.

- `lib/config.ts`: single source of truth for the GitHub App client, endpoints, storage keys, and the escape markers
- `lib/messages.ts`: typed runtime + page-bridge message contracts
- `lib/storage.ts`: typed `chrome.storage` facade
- `lib/diff-service.ts`, `lib/login-service.ts`, `lib/device-fill.ts`, `lib/redirect.ts`: pure cores

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev loop and conventions, and [SECURITY.md](SECURITY.md) for how the extension handles your GitHub token and how to report vulnerabilities.

## License

[MIT](LICENSE) © James Andrews
