/**
 * The diff-serving core (testable without chrome.* or global fetch). Resolves
 * the DiffsHub `/api/diff?path=…` URL to a GitHub REST API URL and fetches the
 * diff with the user's token. Returns `{ ok: false }` rather than throwing for
 * the "let DiffsHub handle it" cases (disabled, signed out, non-diff path).
 */
import { ENDPOINTS } from './config'
import { parseDiffPath, toApiUrl } from '../urls'
import { fetchLargeDiff } from './diff-fallback'
import type { DiffResponse } from './messages'

export interface DiffServiceDeps {
  isEnabled(): Promise<boolean>
  getToken(): Promise<string>
  fetch: typeof fetch
}

export async function fetchDiff(
  diffsHubUrl: string,
  deps: DiffServiceDeps,
): Promise<DiffResponse> {
  if (!(await deps.isEnabled())) return { ok: false }
  const token = await deps.getToken()
  if (token.trim() === '') return { ok: false }

  // DiffsHub calls fetch with a relative URL, so resolve against its origin.
  const pathParam = new URL(diffsHubUrl, ENDPOINTS.diffsHub).searchParams.get('path') // URL-decoded
  const apiUrl = pathParam && toApiUrl(pathParam)
  if (!apiUrl) return { ok: false }

  const res = await deps.fetch(apiUrl, {
    headers: {
      Accept: 'application/vnd.github.diff',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
    },
  })

  // The `.diff` media type caps out at 300 files (406 too_large). Fall back to
  // the paginated files listing and rebuild the diff ourselves.
  if (res.status === 406) {
    const parsed = parseDiffPath(pathParam!)
    const diff = parsed && (await fetchLargeDiff(parsed, token, deps.fetch))
    if (diff != null) return { ok: true, status: 200, body: diff }
  }

  return { ok: true, status: res.status, body: await res.text() }
}
