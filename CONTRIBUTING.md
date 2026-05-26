# Contributing to diffhop

Thanks for your interest in improving diffhop! This is a small Chrome MV3
extension, so the contribution loop is short.

## Development setup

```bash
npm install
npm run build        # bundle into dist/
npm run build:watch  # rebuild on change
```

Load the unpacked extension from `dist/` via `chrome://extensions` →
**Developer mode** → **Load unpacked**.

> There is **no `.env`** to configure. A browser extension has no runtime
> environment, so all configuration is compiled in. Every constant
> (the GitHub App client ID, endpoints, storage keys, escape markers) lives in
> a single module, [`extension/src/lib/config.ts`](extension/src/lib/config.ts).
> Change config there, never inline.

## Before you open a PR

```bash
npm run format:check # Prettier — CI fails on unformatted files
npm test             # vitest unit suite — must stay green
npm run typecheck    # strict tsc, no emit
npm run build        # must produce dist/ cleanly
```

Run `npm run format` to auto-fix formatting. Prettier config lives in
`.prettierrc.json` (semicolon-free, single quotes).

Optionally, drive the built extension end-to-end in a real browser:

```bash
npm run verify:browser
```

## Project layout

```
extension/src/
  lib/          shared, testable modules (config, messages, storage, services)
  *.ts          entry scripts (background / content / popup / diffshub*)
test/           vitest unit tests, mirroring src modules
```

Guidelines:

- **Keep entry scripts thin.** Logic worth testing belongs in `lib/` as a pure
  function with injected dependencies (see `diff-service.ts`, `redirect.ts`,
  `login-service.ts`). The entry scripts only wire `chrome.*` / DOM APIs to it.
- **Add a test with new logic.** New `lib/` behavior should land with a unit
  test; don't weaken or delete existing tests.
- **Strict TypeScript.** No `any`; explicit return types on exported functions.
- **Never rename a persisted storage key** in `config.ts` — doing so silently
  signs out and resets every installed user.

## Reporting bugs & security issues

File functionality bugs as GitHub issues. For anything security-related (this
extension stores a GitHub token), see [SECURITY.md](SECURITY.md) first.
