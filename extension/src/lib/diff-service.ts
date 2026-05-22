/**
 * The diff-serving core, extracted from the background script so it can be unit
 * tested without `chrome.*` or the global `fetch`. Given the DiffsHub
 * `/api/diff?path=…` URL, it resolves the GitHub REST API URL and fetches the
 * diff with the user's token.
 *
 * Returns `{ ok: false }` (rather than throwing) for every "let DiffsHub handle
 * it" case — disabled, signed out, or a path that isn't a diff — so the page
 * falls back to DiffsHub's own backend and public repos keep working.
 */
import { ENDPOINTS } from './config'
import { toApiUrl } from '../urls'
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
  return { ok: true, status: res.status, body: await res.text() }
}
