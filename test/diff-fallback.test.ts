import { describe, it, expect, vi } from 'vitest'
import {
  fileToDiff,
  reconstructDiff,
  fetchLargeDiff,
} from '../extension/src/lib/diff-fallback'

describe('fileToDiff', () => {
  it('rebuilds a modified file with a patch', () => {
    const diff = fileToDiff({
      filename: 'src/app.ts',
      status: 'modified',
      patch: '@@ -1,2 +1,2 @@\n-old\n+new',
    })
    expect(diff).toBe(
      [
        'diff --git a/src/app.ts b/src/app.ts',
        '--- a/src/app.ts',
        '+++ b/src/app.ts',
        '@@ -1,2 +1,2 @@',
        '-old',
        '+new',
      ].join('\n'),
    )
  })

  it('marks an added file against /dev/null', () => {
    const diff = fileToDiff({
      filename: 'new.txt',
      status: 'added',
      patch: '@@ -0,0 +1 @@\n+hi',
    })
    expect(diff).toContain('new file mode 100644')
    expect(diff).toContain('--- /dev/null')
    expect(diff).toContain('+++ b/new.txt')
  })

  it('marks a removed file against /dev/null', () => {
    const diff = fileToDiff({
      filename: 'gone.txt',
      status: 'removed',
      patch: '@@ -1 +0,0 @@\n-bye',
    })
    expect(diff).toContain('deleted file mode 100644')
    expect(diff).toContain('--- a/gone.txt')
    expect(diff).toContain('+++ /dev/null')
  })

  it('records a rename with from/to and both paths in the header', () => {
    const diff = fileToDiff({
      filename: 'b.ts',
      previous_filename: 'a.ts',
      status: 'renamed',
      patch: '@@ -1 +1 @@\n-x\n+y',
    })
    expect(diff).toContain('diff --git a/a.ts b/b.ts')
    expect(diff).toContain('rename from a.ts')
    expect(diff).toContain('rename to b.ts')
    expect(diff).toContain('--- a/a.ts')
    expect(diff).toContain('+++ b/b.ts')
  })

  it('emits a Binary-files line when a non-rename change has no patch', () => {
    const diff = fileToDiff({ filename: 'logo.png', status: 'modified' })
    expect(diff).toBe(
      'diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ',
    )
  })

  it('emits no patch body for a pure rename without changes', () => {
    const diff = fileToDiff({
      filename: 'b.ts',
      previous_filename: 'a.ts',
      status: 'renamed',
    })
    expect(diff).toBe('diff --git a/a.ts b/b.ts\nrename from a.ts\nrename to b.ts')
  })
})

describe('reconstructDiff', () => {
  it('joins multiple file sections with newlines', () => {
    const out = reconstructDiff([
      { filename: 'a.ts', status: 'modified', patch: '@@ -1 +1 @@\n-1\n+2' },
      { filename: 'b.ts', status: 'added', patch: '@@ -0,0 +1 @@\n+new' },
    ])
    expect(out.split('\n').filter((l) => l.startsWith('diff --git'))).toHaveLength(2)
  })

  it('returns an empty string for no files', () => {
    expect(reconstructDiff([])).toBe('')
  })
})

/** Minimal Response stand-in for a JSON files page. */
const jsonPage = (body: unknown, link?: string) =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
    headers: { get: (h: string) => (h.toLowerCase() === 'link' ? (link ?? null) : null) },
  }) as unknown as Response

describe('fetchLargeDiff', () => {
  const pull = { owner: 'o', repo: 'r', type: 'pull' as const, ref: '5' }

  it('hits the pull files endpoint with per_page and rebuilds the diff', async () => {
    const doFetch = vi.fn(async () =>
      jsonPage([{ filename: 'a.ts', status: 'modified', patch: '@@ -1 +1 @@\n-1\n+2' }]),
    ) as unknown as typeof fetch
    const diff = await fetchLargeDiff(pull, 'tok', doFetch)
    expect(diff).toContain('diff --git a/a.ts b/a.ts')
    const [url, init] = (doFetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/o/r/pulls/5/files?per_page=100')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('follows the Link rel="next" header across pages', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonPage(
          [{ filename: 'a.ts', status: 'added', patch: '@@ -0,0 +1 @@\n+a' }],
          '<https://api.github.com/next>; rel="next"',
        ),
      )
      .mockResolvedValueOnce(
        jsonPage([{ filename: 'b.ts', status: 'added', patch: '@@ -0,0 +1 @@\n+b' }]),
      ) as unknown as typeof fetch
    const diff = await fetchLargeDiff(pull, 'tok', doFetch)
    expect((doFetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2)
    expect(diff!.match(/diff --git/g)).toHaveLength(2)
  })

  it('reads files[] from the compare endpoint shape', async () => {
    const doFetch = vi.fn(async () =>
      jsonPage({
        files: [{ filename: 'a.ts', status: 'modified', patch: '@@ -1 +1 @@\n-1\n+2' }],
      }),
    ) as unknown as typeof fetch
    const diff = await fetchLargeDiff(
      { owner: 'o', repo: 'r', type: 'compare', ref: 'main...x' },
      'tok',
      doFetch,
    )
    expect(diff).toContain('diff --git a/a.ts b/a.ts')
    expect((doFetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'https://api.github.com/repos/o/r/compare/main...x?per_page=100',
    )
  })

  it('returns null when the first page fails', async () => {
    const doFetch = vi.fn(
      async () => ({ ok: false, status: 404 }) as Response,
    ) as unknown as typeof fetch
    expect(await fetchLargeDiff(pull, 'tok', doFetch)).toBeNull()
  })
})
