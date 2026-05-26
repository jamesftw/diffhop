/**
 * Single source of truth for the extension's compile-time constants (no runtime
 * env exists in a service worker / content script).
 *
 * STORAGE_KEYS values are persisted in users' chrome.storage; renaming one signs
 * everyone out, so keep them stable across releases.
 */

/** diffhop's GitHub App client ID. An App (not an OAuth App) keeps access
 * read-only by construction; the ID is public, Device Flow needs no secret. */
export const GITHUB_CLIENT_ID = 'Iv23lilMGOrtYO1NhKlZ'

/** External endpoints and origins. */
export const ENDPOINTS = {
  deviceCode: 'https://github.com/login/device/code',
  accessToken: 'https://github.com/login/oauth/access_token',
  githubApi: 'https://api.github.com',
  github: 'https://github.com',
  diffsHub: 'https://diffshub.com',
} as const

/** Where the popup sends users to grant the App access to repos. */
export const APP_INSTALL_URL = 'https://github.com/apps/diffhop/installations/new'

/** Persisted storage keys (sync = config, local = token + transient flags). */
export const STORAGE_KEYS = {
  config: 'diffshub-config',
  token: 'diffshub-token',
  device: 'diffshub-device',
  /** Set when a diff fetch 404s (App not installed on that repo). */
  needsAccess: 'diffshub-needs-access',
} as const

/**
 * Device Flow token poll cadence. The popup polls this often while open (and
 * once immediately on open), so authorization shows within seconds; 5s is
 * GitHub's device-flow floor. The chrome.alarms backstop covers the popup being
 * closed (alarms are clamped to ~30s, too slow to be the primary path).
 */
export const POLL_INTERVAL_SECONDS = 5
export const POLL_ALARM = 'diffshub-poll'
export const POLL_PERIOD_MINUTES = 0.5
export const POLL_DELAY_MINUTES = 0.1

/** Default extension config, applied when nothing is stored yet. */
export const DEFAULT_CONFIG = { enabled: true } as const

/** Tag on page-bridge postMessages so we ignore unrelated ones. */
export const BRIDGE_TAG = 'diffhop'

/**
 * Escape markers. A diffshub.com content script adds SKIP_PARAM to "View on
 * GitHub" links; it's a query (not a hash) so the dNR rule can see it and skip
 * the redirect, and SKIP_FLAG makes the escape sticky per tab.
 */
export const SKIP_PARAM = 'dh-skip'
export const SKIP_FLAG = 'diffshub:skip'
