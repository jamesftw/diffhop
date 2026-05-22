# Security Policy

## How diffhop handles your GitHub credentials

diffhop reads diffs and nothing else, so it authenticates as a **read-only
GitHub App** via the OAuth **Device Flow**. Facts worth knowing:

- **Read-only by construction.** The GitHub App declares **Contents: Read-only**
  and **Pull requests: Read-only**. Because permissions live on the App (not in a
  per-login scope), the grant cannot be widened to write access, and you choose
  exactly which repositories the App can see. GitHub has no read-only _OAuth
  scope_ (the `repo` scope grants write too), which is why an App is used.
- **The Client ID is public by design.** Device Flow uses no client secret, so
  the App's Client ID shipped in the extension (`GITHUB_CLIENT_ID` in
  `extension/src/lib/config.ts`) is not a credential, the same model the `gh`
  CLI uses.
- **The device-code autofill only fills, never submits.** A content script on
  `github.com/login/device` types the displayed code into the activation field;
  it never clicks **Authorize**, so granting access is always your explicit action.
- **The user token is stored in `chrome.storage.local`** (the extension's own
  storage) and nowhere else. It never roams via sync.
- **The token never reaches DiffsHub's page.** When DiffsHub fetches a diff, the
  request is relayed to the extension's background service worker, which makes
  the authenticated GitHub API call and returns only the diff text. The page's
  JavaScript never sees the token.
- **Sign out anytime** from the popup, which clears the stored token.

## Permissions

The extension requests only what it needs (`declarativeNetRequest`, `storage`,
`alarms`) and host access to `github.com`, `diffshub.com`, and `api.github.com`.
See `extension/manifest.json`.

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, report privately via GitHub's
[security advisories](https://github.com/JamesFTW/diffhop/security/advisories/new),
or email the maintainer. You can expect an initial response within a few days.
Please include reproduction steps and the affected version.
