# diffhop — Privacy Policy

_Last updated: 2026-05-25_

diffhop redirects GitHub diff pages to [diffshub.com](https://diffshub.com)
and, for private repositories, fetches diffs from the GitHub API using a
sign-in you initiate.

## Data the extension handles

- **GitHub access token:** If you sign in, the extension obtains a read-only
  GitHub App token via GitHub's Device Flow. It is stored only in your browser's
  local extension storage, and is sent only to GitHub (`api.github.com`) to
  retrieve diffs you request. It is never sent to the diffshub.com page, to the
  developer, or to any third party. Signing out deletes it.
- **Preferences and sign-in state:** Your enabled/disabled setting and transient
  Device Flow state are stored locally via `chrome.storage`.

## Data we do NOT collect

- The developer operates no server and receives no data from the extension.
- We do not collect, store, sell, or transfer your personal data, browsing
  history, or the contents of pages or diffs.
- Diff content is fetched from GitHub and rendered by diffshub.com, which the
  extension does not control; see GitHub's and DiffsHub's own privacy policies
  for their handling.

Permissions (`declarativeNetRequest`, `storage`, `alarms`, and host access to
`github.com`, `api.github.com`, and `diffshub.com`) are used solely to redirect
GitHub diff URLs and, optionally, fetch private diffs on your behalf.

## Contact

Questions or concerns: open an issue at
https://github.com/jamesftw/diffhop/issues
