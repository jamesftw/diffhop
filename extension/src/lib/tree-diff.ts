/**
 * Enumerate a large diff's changed files without asking GitHub to compute the
 * diff. Past the 20k-line cap GitHub refuses every diff-derived view (the
 * `.diff` media type and `pulls/N/files` both fail), but the Git Trees and blobs
 * APIs don't compute a diff, so we list every blob on the base and head trees
 * and compare them by SHA ourselves. Pairs with blob-diff.ts, which rebuilds
 * each changed file from its raw blobs. Pure (injected fetch), like the rest of
 * lib/, and uses only the Contents permission throughout.
 *
 * Returns null ("the caller should show the too-large message") when we can't
 * faithfully recover the file set: a `compare` URL, a failed ref/tree fetch, or
 * a `truncated` tree (>100k entries, which we don't walk subtree-by-subtree).
 */
import { ENDPOINTS } from './config'
import type { ParsedDiffPath } from '../urls'
import type { DiffRefs, FileChange } from './blob-diff'

interface TreeEntry {
  path: string
  type: string // 'blob' | 'tree' | 'commit'
  sha: string
}

export interface TreeDiffResult {
  refs: DiffRefs
  files: FileChange[]
}

const jsonHeaders = (token: string) => ({
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  Authorization: `Bearer ${token}`,
})

/** Read a git ref's target commit SHA, or null on failure. */
async function readRefSha(
  url: string,
  token: string,
  doFetch: typeof fetch,
): Promise<string | null> {
  const res = await doFetch(url, { headers: jsonHeaders(token) })
  if (!res.ok) return null
  const body = (await res.json()) as { object?: { sha?: string } }
  return body.object?.sha ?? null
}

/** Read a git commit object's parent SHAs. Reads the commit object (not the
 * REST commit), so it never computes a diff and never 406s on a huge commit. */
async function getParents(
  repo: string,
  sha: string,
  token: string,
  doFetch: typeof fetch,
): Promise<string[] | null> {
  const res = await doFetch(`${repo}/git/commits/${sha}`, { headers: jsonHeaders(token) })
  if (!res.ok) return null
  const commit = (await res.json()) as { parents?: { sha: string }[] }
  return commit.parents?.map((parent) => parent.sha) ?? []
}

/**
 * Resolve the base/head commit SHAs to diff between.
 *
 * GitHub's PR "Files changed" is the 3-dot diff `merge_base(base, head)…head`,
 * so for a pull we need the head commit and the merge-base:
 *   - head: the `refs/pull/N/head` ref;
 *   - base tip: the "other parent" of the `refs/pull/N/merge` commit;
 *   - merge-base: `compare`'s `merge_base_commit`, which it returns as metadata
 *     even when the diff itself is too large.
 * All of these use only the Contents permission, so it works without
 * `pull_requests:read`. A PR with no merge ref (unmergeable / not yet computed)
 * falls back to the pulls JSON, which does need pull_requests.
 *
 * For a commit, head is the commit and base is its first parent (none = root →
 * an empty base, so every file reads as added).
 */
async function resolveRefs(
  parsed: ParsedDiffPath,
  token: string,
  doFetch: typeof fetch,
): Promise<{ baseSha: string | null; headSha: string } | null> {
  const repo = `${ENDPOINTS.githubApi}/repos/${parsed.owner}/${parsed.repo}`

  if (parsed.type === 'commit') {
    const parents = await getParents(repo, parsed.ref, token, doFetch)
    if (!parents) return null
    return { baseSha: parents[0] ?? null, headSha: parsed.ref }
  }

  const headSha = await readRefSha(
    `${repo}/git/ref/pull/${parsed.ref}/head`,
    token,
    doFetch,
  )
  const mergeSha = await readRefSha(
    `${repo}/git/ref/pull/${parsed.ref}/merge`,
    token,
    doFetch,
  )
  const parents = mergeSha ? await getParents(repo, mergeSha, token, doFetch) : null
  const baseTip = parents?.find((sha) => sha !== headSha) ?? parents?.[0]

  if (headSha && baseTip) {
    const compareRes = await doFetch(`${repo}/compare/${baseTip}...${headSha}`, {
      headers: jsonHeaders(token),
    })
    if (compareRes.ok) {
      const comparison = (await compareRes.json()) as {
        merge_base_commit?: { sha?: string }
      }
      const mergeBase = comparison.merge_base_commit?.sha
      if (mergeBase) return { baseSha: mergeBase, headSha }
    }
    // compare unavailable: best-effort 2-dot against the base tip.
    return { baseSha: baseTip, headSha }
  }

  // No usable refs (rare): fall back to the pulls JSON, which needs pull_requests.
  const res = await doFetch(`${repo}/pulls/${parsed.ref}`, {
    headers: jsonHeaders(token),
  })
  if (!res.ok) return null
  const pr = (await res.json()) as { base?: { sha?: string }; head?: { sha?: string } }
  if (!pr.base?.sha || !pr.head?.sha) return null
  return { baseSha: pr.base.sha, headSha: pr.head.sha }
}

/**
 * Fetch a tree's blob entries as a path→SHA map, or null if the tree fetch fails
 * or is `truncated` (a partial listing would drop changed files). A null SHA
 * means "no tree" (a root commit's base) and yields an empty map.
 */
async function fetchBlobMap(
  parsed: ParsedDiffPath,
  sha: string | null,
  token: string,
  doFetch: typeof fetch,
): Promise<Map<string, string> | null> {
  if (sha == null) return new Map()
  const url = `${ENDPOINTS.githubApi}/repos/${parsed.owner}/${parsed.repo}/git/trees/${sha}?recursive=1`
  const res = await doFetch(url, { headers: jsonHeaders(token) })
  if (!res.ok) return null
  const body = (await res.json()) as { tree?: TreeEntry[]; truncated?: boolean }
  if (body.truncated) return null
  const map = new Map<string, string>()
  for (const entry of body.tree ?? [])
    if (entry.type === 'blob') map.set(entry.path, entry.sha)
  return map
}

/** Compare base/head blob maps into a path-sorted changed-file list. */
function diffTrees(base: Map<string, string>, head: Map<string, string>): FileChange[] {
  const files: FileChange[] = []
  for (const [path, sha] of head) {
    const prev = base.get(path)
    if (prev === undefined) files.push({ path, status: 'added' })
    else if (prev !== sha) files.push({ path, status: 'modified' })
  }
  for (const path of base.keys()) {
    if (!head.has(path)) files.push({ path, status: 'removed' })
  }
  files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )
  return files
}

export async function enumerateChangedFiles(
  parsed: ParsedDiffPath,
  token: string,
  doFetch: typeof fetch,
): Promise<TreeDiffResult | null> {
  if (parsed.type === 'compare') return null // file list caps at 300; can't recover

  const refs = await resolveRefs(parsed, token, doFetch)
  if (!refs) return null

  const [base, head] = await Promise.all([
    fetchBlobMap(parsed, refs.baseSha, token, doFetch),
    fetchBlobMap(parsed, refs.headSha, token, doFetch),
  ])
  if (!base || !head) return null

  return {
    refs: {
      owner: parsed.owner,
      repo: parsed.repo,
      baseSha: refs.baseSha ?? '',
      headSha: refs.headSha,
    },
    files: diffTrees(base, head),
  }
}
