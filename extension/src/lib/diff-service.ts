/**
 * The diff-serving core (testable without chrome.* or global fetch). Resolves
 * the DiffsHub `/api/diff?path=…` URL to a GitHub REST API URL and *streams* the
 * diff with the user's token, so DiffsHub's renderer can paint it line-by-line
 * as bytes arrive (same as its native streamed fetch). Emits to a `DiffSink`
 * rather than returning, and signals `head(false)` — never throws — for the
 * "let DiffsHub handle it" cases (disabled, signed out, non-diff path).
 *
 * Large diffs escalate through a tier ladder:
 *   0  `.diff` media type (this function's normal path) — byte-level streaming.
 *   1  `pulls/N/files` reconstruction — for the 300-file cap.
 *   2  Git Trees + blob-diff — for the 20k-line cap, which 406s endpoints 0 and 1.
 *   3  an authored "too large, view on GitHub" message — when 2 can't recover.
 * Tiers 1-3 stream per file; GitHub's raw 406 JSON is never forwarded to the page.
 */
import { structuredPatch } from 'diff'
import { ENDPOINTS, LARGE_DIFF_BUDGET_BYTES, BLOB_CONCURRENCY } from './config'
import { parseDiffPath, toApiUrl, type ParsedDiffPath } from '../urls'
import { fetchLargeDiff, ESCALATE } from './diff-fallback'
import { enumerateChangedFiles } from './tree-diff'
import { buildFileDiff, type ComputeHunks } from './blob-diff'

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

const encoder = new TextEncoder()

/** jsdiff-backed unified-diff algorithm for the blob-diff (Tier 2) path. */
const computeHunks: ComputeHunks = (oldText, newText) =>
  structuredPatch('a', 'b', oldText, newText, '', '').hunks

/**
 * Bounded-concurrency runner: at most `max` thunks run at once, each resolving
 * independently. Lets Tier 2 fetch blobs in parallel while we still emit their
 * sections in order.
 */
function semaphore(max: number) {
  let active = 0
  const queue: (() => void)[] = []
  const pump = (): void => {
    if (active >= max) return
    active++
    const job = queue.shift()
    if (job) job()
    else active--
  }
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() =>
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--
            pump()
          }),
      )
      pump()
    })
}

/** The diff page's github.com URL, for the Tier 3 "view on GitHub" pointer. */
function githubUrl(parsed: ParsedDiffPath): string {
  return `${ENDPOINTS.github}/${parsed.owner}/${parsed.repo}/${parsed.type}/${parsed.ref}`
}

/** A valid one-file diff carrying a human message — never GitHub's raw 406 JSON. */
function tier3Section(parsed: ParsedDiffPath): string {
  return [
    'diff --git a/DIFF_TOO_LARGE b/DIFF_TOO_LARGE',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/DIFF_TOO_LARGE',
    '@@ -0,0 +1,3 @@',
    "+This diff is too large for GitHub's API to render inline.",
    '+',
    `+View it on GitHub: ${githubUrl(parsed)}`,
  ].join('\n')
}

/** Split a reconstructed unified diff into per-file chunks (keeps each chunk
 * small enough to clear the messaging size ceiling, vs one giant postMessage). */
function emitSections(diff: string, sink: DiffSink): void {
  for (const section of diff.split(/(?=^diff --git )/m)) {
    if (section) sink.chunk(encoder.encode(section))
  }
}

/** Tier 2: enumerate via trees, then emit each file's blob-diff section in file
 * order while fetching them concurrently. Assumes `head` was already sent. */
async function streamBlobDiffs(
  parsed: ParsedDiffPath,
  token: string,
  doFetch: typeof fetch,
  files: Awaited<ReturnType<typeof enumerateChangedFiles>>,
  sink: DiffSink,
): Promise<void> {
  const { refs, files: changes } = files!
  const run = semaphore(BLOB_CONCURRENCY)
  const deps = { fetch: doFetch, computeHunks }
  const pending = changes.map((change) =>
    run(() => buildFileDiff(change, refs, token, deps)),
  )

  let used = 0
  for (let i = 0; i < pending.length; i++) {
    const bytes = encoder.encode((i === 0 ? '' : '\n') + (await pending[i]))
    if (used + bytes.byteLength > LARGE_DIFF_BUDGET_BYTES) {
      sink.chunk(encoder.encode(`\n${tier3Section(parsed)}`)) // budget hit → note + stop
      return
    }
    sink.chunk(bytes)
    used += bytes.byteLength
  }
}

/**
 * Serve a 406 (too-large) diff through the tier ladder. Owns its `head`/`end`
 * so it emits exactly one head per call. Never forwards GitHub's raw 406 body.
 */
async function serveLargeDiff(
  pathParam: string,
  token: string,
  doFetch: typeof fetch,
  sink: DiffSink,
): Promise<void> {
  const parsed = parseDiffPath(pathParam)
  const tier1 = parsed && (await fetchLargeDiff(parsed, token, doFetch))

  // Tier 1 rebuilt the diff from the files listing (300-file cap case).
  if (typeof tier1 === 'string') {
    sink.head(true, 200)
    emitSections(tier1, sink)
    return sink.end()
  }

  // Tier 2: the files endpoint couldn't serve it → enumerate via trees.
  if (parsed && tier1 === ESCALATE) {
    const enumerated = await enumerateChangedFiles(parsed, token, doFetch)
    if (enumerated && enumerated.files.length > 0) {
      sink.head(true, 200)
      await streamBlobDiffs(parsed, token, doFetch, enumerated, sink)
      return sink.end()
    }
  }

  // Tier 3: unrecoverable (compare, >3000 files, truncated tree, no files) →
  // an authored message, not GitHub's raw 406 JSON.
  sink.head(true, 200)
  if (parsed) sink.chunk(encoder.encode(tier3Section(parsed)))
  sink.end()
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
  // GitHub fetch (and the trees/blobs fallback) instead of downloading on.
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

    // Over GitHub's diff caps (406 too_large): escalate through the tier ladder,
    // which owns its own head/chunk/end and never leaks the raw 406 body.
    if (res.status === 406) {
      return await serveLargeDiff(pathParam!, token, doFetch, sink)
    }

    sink.head(true, res.status)
    if (res.body) {
      const reader = res.body.getReader()
      try {
        let read = await reader.read()
        while (!read.done) {
          if (read.value) sink.chunk(read.value)
          read = await reader.read()
        }
      } finally {
        // Release the lock so the body can be GC'd / the socket freed, even if
        // a read rejected (abort) and we're unwinding to the catch below.
        reader.releaseLock()
      }
    } else {
      // No readable stream (shouldn't happen for fetch, but stay correct).
      sink.chunk(encoder.encode(await res.text()))
    }
    sink.end()
  } catch {
    // Network failure or aborted mid-stream: surface a stream error. (If head
    // was already sent, this errors the page's Response; if not, the caller
    // treats a head-less error as "fall back".)
    sink.error()
  }
}
