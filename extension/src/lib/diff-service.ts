/**
 * The diff-serving core (testable without chrome.* or global fetch). Resolves
 * the DiffsHub `/api/diff?path=…` URL to a GitHub REST API URL and *streams* the
 * diff with the user's token, so DiffsHub's renderer can paint it line-by-line
 * as bytes arrive (same as its native streamed fetch). Emits to a `DiffSink`
 * rather than returning, and signals `head(false)` — never throws — for the
 * "let DiffsHub handle it" cases (disabled, signed out, non-diff path).
 */
import { ENDPOINTS } from './config'
import { parseDiffPath, toApiUrl } from '../urls'
import { fetchLargeDiff } from './diff-fallback'

export interface DiffServiceDeps {
  isEnabled(): Promise<boolean>
  getToken(): Promise<string>
  fetch: typeof fetch
  /** Aborts the upstream fetch when the page cancels the response body. */
  signal?: AbortSignal
}

/**
 * Receiver for a streamed diff. The contract is exactly one `head`, then (only
 * if `head.ok`) zero or more `chunk`s, then exactly one `end` or `error`.
 */
export interface DiffSink {
  /** `ok:false` → caller should fall back to DiffsHub's own fetch. */
  head(ok: boolean, status?: number): void
  chunk(bytes: Uint8Array): void
  end(): void
  error(): void
}

export async function streamDiff(
  diffsHubUrl: string,
  deps: DiffServiceDeps,
  sink: DiffSink,
): Promise<void> {
  if (!(await deps.isEnabled())) return sink.head(false)
  const token = await deps.getToken()
  if (token.trim() === '') return sink.head(false)

  // DiffsHub calls fetch with a relative URL, so resolve against its origin.
  const pathParam = new URL(diffsHubUrl, ENDPOINTS.diffsHub).searchParams.get('path') // URL-decoded
  const apiUrl = pathParam && toApiUrl(pathParam)
  if (!apiUrl) return sink.head(false)

  // Bind the abort signal to every request so a page cancel tears down the
  // GitHub fetch (and the files-listing fallback) instead of downloading on.
  const doFetch: typeof fetch = (input, init) =>
    deps.fetch(input, { ...init, signal: deps.signal })

  try {
    const res = await doFetch(apiUrl, {
      headers: {
        Accept: 'application/vnd.github.diff',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token}`,
      },
    })

    // The `.diff` media type caps out at 300 files (406 too_large). Fall back to
    // the paginated files listing and rebuild the diff. This path can't stream
    // (the diff is reconstructed from many JSON pages), so it emits one chunk.
    if (res.status === 406) {
      const parsed = parseDiffPath(pathParam!)
      const diff = parsed && (await fetchLargeDiff(parsed, token, doFetch))
      if (diff != null) {
        sink.head(true, 200)
        sink.chunk(new TextEncoder().encode(diff))
        return sink.end()
      }
      // else: fall through and stream the original 406 body unchanged.
    }

    sink.head(true, res.status)
    if (res.body) {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) sink.chunk(value)
      }
    } else {
      // No readable stream (shouldn't happen for fetch, but stay correct).
      sink.chunk(new TextEncoder().encode(await res.text()))
    }
    sink.end()
  } catch {
    // Network failure or aborted mid-stream: surface a stream error. (If head
    // was already sent, this errors the page's Response; if not, the caller
    // treats a head-less error as "fall back".)
    sink.error()
  }
}
