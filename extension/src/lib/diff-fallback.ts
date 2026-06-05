/**
 * Fallback for diffs too large for the `application/vnd.github.diff` media type.
 *
 * GitHub caps that media type at 300 files and returns `406 too_large` beyond
 * it. The documented escape hatch is the JSON "files" listing, which paginates
 * and carries a per-file `patch`. We page through it and stitch the patches
 * back into a standard unified git diff so DiffsHub's parser sees the same
 * shape it would from the raw `.diff`. Kept free of chrome.* and global fetch
 * (fetch is injected) so it stays unit-testable like the rest of lib/.
 */
import { ENDPOINTS } from './config'
import type { DiffType, ParsedDiffPath } from '../urls'

/** Subset of a GitHub "file" object that we need to rebuild a diff. */
interface GitHubFile {
  filename: string
  previous_filename?: string
  status: string // added | removed | modified | renamed | copied | changed | unchanged
  patch?: string // unified hunks; absent for binary files, large diffs, pure renames
}

// The files endpoints page at up to 100 items; cap pages so a pathological PR
// can't spin forever. GitHub itself stops listing files at 3000.
const PER_PAGE = 100
const MAX_PAGES = 30

/**
 * Signal that the files endpoint couldn't serve a complete diff, so the caller
 * should try the Git Trees + blob-diff path (Tier 2) instead of failing closed.
 * This covers every non-success the files listing can hit: the 20k-line cap
 * (which 406/403s the files endpoint), a GitHub-App permission rejection
 * ("Resource not accessible by integration"), a rate limit, an incomplete
 * pagination, or an empty listing. Tier 2 uses `contents:read` (not the files
 * endpoint's permission) and self-guards — it falls to the Tier 3 message if it
 * can't enumerate — so escalating is always safe and recovers more cases.
 * Distinct from null, which means "Tier 2 can't help either" (only `compare`).
 */
export const ESCALATE = Symbol('diffhop.escalate')

/** The REST endpoint whose JSON carries the per-file patches, for each surface. */
function filesApiUrl({ owner, repo, type, ref }: ParsedDiffPath): string {
  const base = `${ENDPOINTS.githubApi}/repos/${owner}/${repo}`
  if (type === 'pull') return `${base}/pulls/${ref}/files`
  if (type === 'commit') return `${base}/commits/${ref}`
  return `${base}/compare/${ref}` // compare
}

/**
 * Where the file array lives in the response: the pull "files" endpoint returns
 * a bare array; commit and compare return an object with a `files` field.
 */
function extractFiles(type: DiffType, json: unknown): GitHubFile[] {
  if (type === 'pull') return Array.isArray(json) ? (json as GitHubFile[]) : []
  const files = (json as { files?: unknown })?.files
  return Array.isArray(files) ? (files as GitHubFile[]) : []
}

/**
 * Rebuild one file's section of a unified git diff from its files-API entry, or
 * '' for an entry that contributes no diff (status 'unchanged'). A bare
 * `diff --git` header with no body would corrupt the boundary with the next
 * file, so such entries are dropped by reconstructDiff.
 */
export function fileToDiff(f: GitHubFile): string {
  if (f.status === 'unchanged') return ''

  const newPath = f.filename
  const oldPath = f.previous_filename ?? f.filename
  const added = f.status === 'added'
  const removed = f.status === 'removed'
  const lines = [`diff --git a/${oldPath} b/${newPath}`]

  if (added) lines.push('new file mode 100644')
  else if (removed) lines.push('deleted file mode 100644')
  else if (f.status === 'copied') lines.push(`copy from ${oldPath}`, `copy to ${newPath}`)
  else if (
    f.status === 'renamed' ||
    (f.previous_filename && f.previous_filename !== newPath)
  ) {
    lines.push(`rename from ${oldPath}`, `rename to ${newPath}`)
  }

  if (f.patch) {
    lines.push(`--- ${added ? '/dev/null' : `a/${oldPath}`}`)
    lines.push(`+++ ${removed ? '/dev/null' : `b/${newPath}`}`)
    lines.push(f.patch)
  } else if (f.status !== 'renamed' && f.status !== 'copied') {
    // No patch: GitHub omits it for binary files AND for text files whose diff
    // exceeds its size limit — common in the large PRs this path handles. We
    // can't tell them apart or recover the content, so emit the parser-safe
    // "Binary files" marker against the correct /dev/null side for add/delete.
    const oldSide = added ? '/dev/null' : `a/${oldPath}`
    const newSide = removed ? '/dev/null' : `b/${newPath}`
    lines.push(`Binary files ${oldSide} and ${newSide} differ`)
  }

  return lines.join('\n')
}

/** Stitch a list of files-API entries into one unified diff (dropping empties). */
export function reconstructDiff(files: GitHubFile[]): string {
  return files
    .map(fileToDiff)
    .filter((section) => section !== '')
    .join('\n')
}

/** Follow the `rel="next"` URL from a Link header, if any. */
function nextLink(header: string | null): string | null {
  if (!header) return null
  const m = /<([^>]+)>\s*;\s*rel="next"/.exec(header)
  return m ? m[1] : null
}

/**
 * Page through the files listing for a diff and rebuild it as a unified diff.
 * Three outcomes:
 *   - a string: a complete rebuilt diff (the 300-file cap case the files
 *     endpoint still serves);
 *   - ESCALATE: the files endpoint couldn't serve it (size cap, App-permission
 *     rejection, rate limit, incomplete page, or empty) → the caller tries the
 *     Git Trees path, which can recover it and self-guards;
 *   - null: not worth trying Tier 2 either — only `compare`, or >MAX_PAGES
 *     (>3000 files, too many to blob-diff) → the caller shows the Tier 3 message.
 */
export async function fetchLargeDiff(
  parsed: ParsedDiffPath,
  token: string,
  doFetch: typeof fetch,
): Promise<string | typeof ESCALATE | null> {
  // compare/{basehead} only ever returns the first 300 files; Tier 2 can't help
  // it either (no base/head pair to tree-diff), so fail straight to Tier 3.
  if (parsed.type === 'compare') return null

  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${token}`,
  }

  const first = new URL(filesApiUrl(parsed))
  first.searchParams.set('per_page', String(PER_PAGE))

  const files: GitHubFile[] = []
  let url: string | null = first.toString()
  for (let page = 0; url; page++) {
    if (page >= MAX_PAGES) return null // >3000 files: too many to blob-diff in Tier 2
    const res: Response = await doFetch(url, { headers })
    // Any files-endpoint failure (line cap, App-permission rejection, rate limit,
    // an incomplete later page) → hand off to the trees path, which can recover it.
    if (!res.ok) return ESCALATE
    files.push(...extractFiles(parsed.type, await res.json()))
    url = nextLink(res.headers.get('Link'))
  }
  // A complete listing rebuilds the diff; an empty one escalates (trees may find
  // the changes the files endpoint wouldn't list).
  return files.length > 0 ? reconstructDiff(files) : ESCALATE
}
