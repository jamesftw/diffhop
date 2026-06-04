/**
 * Per-file diff builder for the large-diff path. When GitHub refuses to compute
 * a diff for a PR past the 20k-line cap, we enumerate the changed files via the
 * Git Trees API (tree-diff.ts) and rebuild each file's section *here* from its
 * raw base/head blobs. Kept free of chrome.* and global fetch (both injected) so it
 * unit-tests like the rest of lib/; the unified-diff algorithm is injected too
 * (`computeHunks`) so the formatting logic is testable without jsdiff.
 *
 * A file that can't be diffed inline — binary, over `BLOB_MAX_BYTES`, or a failed
 * blob fetch — degrades to the parser-safe `Binary files … differ` marker rather
 * than throwing, so one bad file never sinks the whole diff.
 */
import { ENDPOINTS, BLOB_RAW_ACCEPT, BLOB_MAX_BYTES } from './config'

/** A changed file as enumerated by tree-diff (no renames: remove + add). */
export interface FileChange {
  path: string
  status: 'added' | 'removed' | 'modified'
}

/** The two commit SHAs a file is diffed between, plus the repo it lives in. */
export interface DiffRefs {
  owner: string
  repo: string
  baseSha: string
  headSha: string
}

/** One unified-diff hunk; `lines` are already prefixed ' ', '-', '+', or '\'. */
export interface Hunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

/** Injected unified-diff algorithm (jsdiff `structuredPatch` in production). */
export type ComputeHunks = (oldText: string, newText: string) => Hunk[]

export interface BlobDiffDeps {
  fetch: typeof fetch
  computeHunks: ComputeHunks
  /** Per-file ceiling; over it, the file degrades to a marker. */
  maxBytes?: number
}

/** A NUL byte in the first few KB is the standard "this is binary" heuristic. */
export function looksBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 8000)
  for (let i = 0; i < limit; i++) if (bytes[i] === 0) return true
  return false
}

/** `diff --git` + the new/deleted-file mode line for added/removed. */
function header(change: FileChange): string[] {
  const lines = [`diff --git a/${change.path} b/${change.path}`]
  if (change.status === 'added') lines.push('new file mode 100644')
  else if (change.status === 'removed') lines.push('deleted file mode 100644')
  return lines
}

/** The /dev/null-aware `a/`/`b/` sides for the `---`/`+++` and binary lines. */
function sides(change: FileChange): { old: string; new: string } {
  return {
    old: change.status === 'added' ? '/dev/null' : `a/${change.path}`,
    new: change.status === 'removed' ? '/dev/null' : `b/${change.path}`,
  }
}

/** The parser-safe degrade marker (binary, oversize, or failed fetch). */
function marker(change: FileChange): string {
  const paths = sides(change)
  return [...header(change), `Binary files ${paths.old} and ${paths.new} differ`].join(
    '\n',
  )
}

function formatHunk(hunk: Hunk): string[] {
  const hunkHeader = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
  return [hunkHeader, ...hunk.lines]
}

/** Encode a repo path for the contents API: percent-encode segments, keep `/`. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/**
 * Fetch one side's raw blob, or null if it can't be used inline (non-ok status,
 * a thrown fetch, or larger than `maxBytes` — checked via Content-Length before
 * the body is read, then again on the actual bytes).
 */
async function fetchRaw(
  refs: DiffRefs,
  path: string,
  sha: string,
  token: string,
  deps: BlobDiffDeps,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const url = `${ENDPOINTS.githubApi}/repos/${refs.owner}/${refs.repo}/contents/${encodePath(path)}?ref=${sha}`
  let res: Response
  try {
    res = await deps.fetch(url, {
      headers: {
        Accept: BLOB_RAW_ACCEPT,
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token}`,
      },
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  const len = Number(res.headers.get('content-length'))
  if (len > maxBytes) return null
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength > maxBytes) return null
  return bytes
}

/**
 * Build one file's unified-diff section from its raw blobs. Added files fetch
 * only the head side, removed only the base; modified fetch both. Any
 * un-diffable side degrades the whole file to a marker.
 */
export async function buildFileDiff(
  change: FileChange,
  refs: DiffRefs,
  token: string,
  deps: BlobDiffDeps,
): Promise<string> {
  const maxBytes = deps.maxBytes ?? BLOB_MAX_BYTES

  const base =
    change.status === 'added'
      ? new Uint8Array()
      : await fetchRaw(refs, change.path, refs.baseSha, token, deps, maxBytes)
  const head =
    change.status === 'removed'
      ? new Uint8Array()
      : await fetchRaw(refs, change.path, refs.headSha, token, deps, maxBytes)

  if (base == null || head == null) return marker(change)
  if (looksBinary(base) || looksBinary(head)) return marker(change)

  const decoder = new TextDecoder()
  const hunks = deps.computeHunks(decoder.decode(base), decoder.decode(head))
  const paths = sides(change)
  return [
    ...header(change),
    `--- ${paths.old}`,
    `+++ ${paths.new}`,
    ...hunks.flatMap(formatHunk),
  ].join('\n')
}
