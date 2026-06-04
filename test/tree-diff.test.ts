import { describe, it, expect, vi } from 'vitest'
import { enumerateChangedFiles } from '../extension/src/lib/tree-diff'
import type { ParsedDiffPath } from '../extension/src/urls'

const json = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as unknown as Response

const pull: ParsedDiffPath = { owner: 'o', repo: 'r', type: 'pull', ref: '5' }
const blob = (path: string, sha: string) => ({ path, type: 'blob', sha })

/**
 * Route the contents-only ref resolution for PR #5: the head ref, the merge ref
 * (whose commit's parents give the base tip), and compare's merge-base. Any
 * field left out makes that call fail (404, or 406 for compare). `trees` is
 * keyed by commit SHA; `commits` maps a SHA to its parent SHAs.
 */
function router(opts: {
  head?: string
  merge?: string
  parents?: string[]
  mergeBase?: string
  commits?: Record<string, string[]>
  trees?: Record<string, { tree: unknown[]; truncated?: boolean }>
  pullJson?: { base?: { sha?: string }; head?: { sha?: string } }
}) {
  const commits = { ...(opts.commits ?? {}) }
  if (opts.merge && opts.parents) commits[opts.merge] = opts.parents
  return vi.fn(async (url: string) => {
    const u = String(url)
    if (u.endsWith('/git/ref/pull/5/head'))
      return opts.head ? json({ object: { sha: opts.head } }) : json({}, false, 404)
    if (u.endsWith('/git/ref/pull/5/merge'))
      return opts.merge ? json({ object: { sha: opts.merge } }) : json({}, false, 404)
    const commitSha = /\/git\/commits\/([^?]+)/.exec(u)?.[1]
    if (commitSha)
      return commits[commitSha]
        ? json({ parents: commits[commitSha].map((sha) => ({ sha })) })
        : json({}, false, 404)
    if (u.includes('/compare/'))
      return opts.mergeBase
        ? json({ merge_base_commit: { sha: opts.mergeBase } })
        : json({}, false, 406)
    if (u.endsWith('/pulls/5'))
      return opts.pullJson ? json(opts.pullJson) : json({}, false, 403)
    const treeSha = /\/git\/trees\/([^?]+)\?/.exec(u)?.[1]
    if (treeSha) return json((opts.trees ?? {})[treeSha] ?? { tree: [] })
    throw new Error('unexpected url ' + u)
  }) as unknown as typeof fetch
}

describe('enumerateChangedFiles', () => {
  it('resolves a PR 3-dot diff: head ref + merge-base from compare, then diffs trees', async () => {
    const doFetch = router({
      head: 'H',
      merge: 'M',
      parents: ['BTIP', 'H'],
      mergeBase: 'MB',
      trees: {
        MB: { tree: [blob('a.ts', '1'), blob('gone.ts', '2'), blob('same.ts', '9')] },
        H: { tree: [blob('a.ts', '1b'), blob('new.ts', '3'), blob('same.ts', '9')] },
      },
    })
    const result = await enumerateChangedFiles(pull, 'tok', doFetch)
    expect(result!.refs).toEqual({ owner: 'o', repo: 'r', baseSha: 'MB', headSha: 'H' })
    // unchanged same.ts dropped; sorted by path
    expect(result!.files).toEqual([
      { path: 'a.ts', status: 'modified' },
      { path: 'gone.ts', status: 'removed' },
      { path: 'new.ts', status: 'added' },
    ])
  })

  it('uses the contents-only ref endpoints (head ref, merge ref, compare, trees)', async () => {
    const doFetch = router({
      head: 'H',
      merge: 'M',
      parents: ['BTIP', 'H'],
      mergeBase: 'MB',
      trees: { MB: { tree: [] }, H: { tree: [blob('x.ts', '1')] } },
    })
    await enumerateChangedFiles(pull, 'tok', doFetch)
    const urls = (doFetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]))
    expect(urls).toContain('https://api.github.com/repos/o/r/git/ref/pull/5/head')
    expect(urls).toContain('https://api.github.com/repos/o/r/git/ref/pull/5/merge')
    expect(urls).toContain('https://api.github.com/repos/o/r/git/commits/M')
    expect(
      urls.some((u) => u.startsWith('https://api.github.com/repos/o/r/compare/BTIP...H')),
    ).toBe(true)
    expect(urls).toContain('https://api.github.com/repos/o/r/git/trees/MB?recursive=1')
    expect(urls).toContain('https://api.github.com/repos/o/r/git/trees/H?recursive=1')
  })

  it('falls back to a 2-dot diff against the base tip when compare is unavailable', async () => {
    const doFetch = router({
      head: 'H',
      merge: 'M',
      parents: ['BTIP', 'H'],
      // no mergeBase → compare 406s
      trees: { BTIP: { tree: [blob('a.ts', '1')] }, H: { tree: [blob('a.ts', '2')] } },
    })
    const result = await enumerateChangedFiles(pull, 'tok', doFetch)
    expect(result!.refs.baseSha).toBe('BTIP')
    expect(result!.files).toEqual([{ path: 'a.ts', status: 'modified' }])
  })

  it('falls back to the pulls JSON when the PR has no usable git refs', async () => {
    const doFetch = router({
      pullJson: { base: { sha: 'B' }, head: { sha: 'H' } },
      trees: { B: { tree: [] }, H: { tree: [blob('x.ts', '1')] } },
    })
    const result = await enumerateChangedFiles(pull, 'tok', doFetch)
    expect(result!.refs).toMatchObject({ baseSha: 'B', headSha: 'H' })
    expect(result!.files).toEqual([{ path: 'x.ts', status: 'added' }])
  })

  it('returns null when neither the git refs nor the pulls JSON resolve', async () => {
    expect(await enumerateChangedFiles(pull, 'tok', router({}))).toBeNull()
  })

  it('resolves a commit: head=sha, base=first parent (via the git commit object)', async () => {
    const doFetch = router({
      commits: { abc: ['BASE'] },
      trees: { BASE: { tree: [blob('a.ts', '1')] }, abc: { tree: [blob('a.ts', '2')] } },
    })
    const result = await enumerateChangedFiles(
      { owner: 'o', repo: 'r', type: 'commit', ref: 'abc' },
      'tok',
      doFetch,
    )
    expect(result!.refs).toMatchObject({ baseSha: 'BASE', headSha: 'abc' })
    expect(result!.files).toEqual([{ path: 'a.ts', status: 'modified' }])
  })

  it('treats a root commit (no parents) as all-added against an empty base', async () => {
    const doFetch = router({
      commits: { root: [] },
      trees: { root: { tree: [blob('a.ts', '1'), blob('b.ts', '2')] } },
    })
    const result = await enumerateChangedFiles(
      { owner: 'o', repo: 'r', type: 'commit', ref: 'root' },
      'tok',
      doFetch,
    )
    expect(result!.files).toEqual([
      { path: 'a.ts', status: 'added' },
      { path: 'b.ts', status: 'added' },
    ])
  })

  it('ignores non-blob tree entries (dirs, submodules)', async () => {
    const doFetch = router({
      head: 'H',
      merge: 'M',
      parents: ['BTIP', 'H'],
      mergeBase: 'MB',
      trees: {
        MB: { tree: [] },
        H: {
          tree: [
            { path: 'src', type: 'tree', sha: 't1' },
            { path: 'mod', type: 'commit', sha: 'c1' },
            blob('real.ts', 'b1'),
          ],
        },
      },
    })
    const result = await enumerateChangedFiles(pull, 'tok', doFetch)
    expect(result!.files).toEqual([{ path: 'real.ts', status: 'added' }])
  })

  it('returns null when a tree is truncated', async () => {
    const doFetch = router({
      head: 'H',
      merge: 'M',
      parents: ['BTIP', 'H'],
      mergeBase: 'MB',
      trees: { MB: { tree: [] }, H: { tree: [blob('a.ts', '1')], truncated: true } },
    })
    expect(await enumerateChangedFiles(pull, 'tok', doFetch)).toBeNull()
  })

  it('returns null when a tree fetch fails', async () => {
    const doFetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.endsWith('/git/ref/pull/5/head')) return json({ object: { sha: 'H' } })
      if (u.endsWith('/git/ref/pull/5/merge')) return json({ object: { sha: 'M' } })
      if (u.includes('/git/commits/M'))
        return json({ parents: [{ sha: 'BTIP' }, { sha: 'H' }] })
      if (u.includes('/compare/')) return json({ merge_base_commit: { sha: 'MB' } })
      if (u.includes('/git/trees/')) return json({}, false, 500)
      throw new Error('unexpected url ' + u)
    }) as unknown as typeof fetch
    expect(await enumerateChangedFiles(pull, 'tok', doFetch)).toBeNull()
  })

  it('returns null for compare (out of scope)', async () => {
    const doFetch = vi.fn() as unknown as typeof fetch
    expect(
      await enumerateChangedFiles(
        { owner: 'o', repo: 'r', type: 'compare', ref: 'a...b' },
        'tok',
        doFetch,
      ),
    ).toBeNull()
    expect(doFetch).not.toHaveBeenCalled()
  })
})
