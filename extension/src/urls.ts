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
  /^https:\/\/github\.com(\/[^/]+\/[^/]+\/(?:pull\/\d+|commit\/[0-9a-fA-F]{7,40}|compare\/[^/?#]+?))(?:\.diff|\.patch)?(?:[/?#].*)?$/

export function matchGitHubDiffUrl(url: string): { path: string } | null {
  const m = DIFF_URL_RE.exec(url)
  if (!m) return null
  return { path: m[1] }
}

export function toDiffsHubUrl(url: string): string | null {
  const match = matchGitHubDiffUrl(url)
  if (!match) return null
  return `https://diffshub.com${match.path}`
}

/**
 * Translate a GitHub diff page path to its REST API URL (diff is fetched with
 * the `Accept: application/vnd.github.diff` media type). Returns null for paths
 * that aren't a pull/commit/compare diff.
 *   /o/r/pull/123      → https://api.github.com/repos/o/r/pulls/123
 *   /o/r/commit/<sha>  → https://api.github.com/repos/o/r/commits/<sha>
 *   /o/r/compare/a...b → https://api.github.com/repos/o/r/compare/a...b
 */
export type DiffType = 'pull' | 'commit' | 'compare'

export interface ParsedDiffPath {
  owner: string
  repo: string
  type: DiffType
  ref: string
}

/**
 * Parse a GitHub diff page path into its components, or null for paths that
 * aren't a pull/commit/compare diff. The `.diff`/`.patch` suffix is stripped
 * first so both the page URL and its raw-diff form parse the same.
 */
export function parseDiffPath(path: string): ParsedDiffPath | null {
  const clean = path.replace(/\.(diff|patch)$/, '')
  const m = /^\/([^/]+)\/([^/]+)\/(pull|commit|compare)\/(.+)$/.exec(clean)
  if (!m) return null
  const [, owner, repo, type, ref] = m
  return { owner, repo, type: type as DiffType, ref }
}

export function toApiUrl(path: string): string | null {
  const parsed = parseDiffPath(path)
  if (!parsed) return null
  const { owner, repo, type, ref } = parsed
  const apiType = type === 'pull' ? 'pulls' : type === 'commit' ? 'commits' : 'compare'
  return `https://api.github.com/repos/${owner}/${repo}/${apiType}/${ref}`
}
