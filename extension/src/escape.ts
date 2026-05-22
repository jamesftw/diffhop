/**
 * Shared constants for the "escape back to GitHub" mechanism.
 *
 * DiffsHub's "View on GitHub" link is `rel="noreferrer"`, so we can't detect
 * the origin via referrer. Instead, a content script on diffshub.com adds the
 * SKIP_PARAM query to those links. It's a *query* (not a hash) so the network
 * -layer declarativeNetRequest redirect rule can see it and exempt the request;
 * the GitHub content script then strips it and records SKIP_FLAG so the escape
 * is sticky for in-page navigation within the tab.
 */
export const SKIP_PARAM = 'dh-skip';
export const SKIP_FLAG = 'diffshub:skip';
