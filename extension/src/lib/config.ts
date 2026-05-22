/**
 * Single source of truth for every compile-time constant in the extension:
 * the GitHub App client, endpoints, storage keys, poll cadence, and the
 * page-bridge tag.
 *
 * A browser extension has no runtime environment (`process.env` is unavailable
 * in a service worker / content script), so "config" here means values baked in
 * at build time. Centralizing them removes the constant drift that comes from
 * re-declaring the same string literal in several entry scripts.
 *
 * NOTE: the `STORAGE_KEYS` values are persisted in users' `chrome.storage`.
 * Changing them would silently sign out and reset every installed user, so they
 * must stay byte-identical across releases.
 */

/**
 * The diffhop **GitHub App** client ID. A GitHub App (not an OAuth App) is used
 * so access is read-only by construction: the app declares Contents +
 * Pull requests as Read-only, and the user can't grant more. The client ID is
 * public by design (Device Flow needs no secret), like the `gh` CLI's.
 *
 * The diffhop GitHub App is owned by the diffhop org and installable on any
 * account.
 */
export const GITHUB_CLIENT_ID = 'Iv23lilMGOrtYO1NhKlZ'

/** External endpoints and origins. */
export const ENDPOINTS = {
  deviceCode: 'https://github.com/login/device/code',
  accessToken: 'https://github.com/login/oauth/access_token',
  githubApi: 'https://api.github.com',
  github: 'https://github.com',
  diffsHub: 'https://diffshub.com',
} as const

/**
 * The diffhop GitHub App's installation page (github.com/apps/diffhop). Sign-in
 * authorizes the App, but it can only read repos it's *installed* on, so the
 * popup links here to let the user grant repositories.
 */
export const APP_INSTALL_URL = 'https://github.com/apps/diffhop/installations/new'

/** Persisted storage keys (sync = config, local = token + transient flags). */
export const STORAGE_KEYS = {
  config: 'diffshub-config',
  token: 'diffshub-token',
  device: 'diffshub-device',
  /** Set when a diff fetch 404s (App not installed on that repo). */
  needsAccess: 'diffshub-needs-access',
} as const

/** chrome.alarms name for the Device Flow token poll. */
export const POLL_ALARM = 'diffshub-poll'

/** Device Flow poll cadence (chrome.alarms is minute-granular). */
export const POLL_PERIOD_MINUTES = 0.5
export const POLL_DELAY_MINUTES = 0.1

/** Default extension config, applied when nothing is stored yet. */
export const DEFAULT_CONFIG = { enabled: true } as const

/** Tag stamped on page-bridge postMessages so we ignore unrelated messages. */
export const BRIDGE_TAG = 'diffhop'

/**
 * Escape-back-to-GitHub markers. DiffsHub's "View on GitHub" link is
 * `rel="noreferrer"`, so origin can't be detected via referrer. Instead a
 * content script on diffshub.com adds `SKIP_PARAM` to those links. It's a
 * *query* (not a hash) so the network-layer declarativeNetRequest rule can see
 * it and exempt the request; the GitHub content script then strips it and
 * records `SKIP_FLAG` so the escape is sticky for in-page navigation.
 */
export const SKIP_PARAM = 'dh-skip'
export const SKIP_FLAG = 'diffshub:skip'
