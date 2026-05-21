/**
 * Pure URL matching for GitHub diff routes. Single source of truth shared by
 * the background service worker and the content-script fallback.
 *
 * Matches the three GitHub diff surfaces:
 *   - /:org/:repo/pull/:number
 *   - /:org/:repo/commit/:sha          (7–40 hex chars)
 *   - /:org/:repo/compare/:range       (covers both `a..b` and `a...b`)
 *
 * An optional `.diff`/`.patch` suffix, PR sub-tabs (`/files`, `/commits`, …),
 * query strings, and hash fragments are all normalized away so the result is
 * the canonical path DiffsHub serves.
 */
const DIFF_URL_RE =
  /^https:\/\/github\.com(\/[^/]+\/[^/]+\/(?:pull\/\d+|commit\/[0-9a-fA-F]{7,40}|compare\/[^/?#]+?))(?:\.diff|\.patch)?(?:[/?#].*)?$/;

export function matchGitHubDiffUrl(url: string): { path: string } | null {
  const m = DIFF_URL_RE.exec(url);
  if (!m) return null;
  return { path: m[1] };
}

export function toDiffsHubUrl(url: string): string | null {
  const match = matchGitHubDiffUrl(url);
  if (!match) return null;
  return `https://diffshub.com${match.path}`;
}
