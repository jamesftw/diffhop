import { describe, it, expect, vi } from 'vitest'
import { buildFileDiff, looksBinary } from '../extension/src/lib/blob-diff'
import type { ComputeHunks, DiffRefs, Hunk } from '../extension/src/lib/blob-diff'

const refs: DiffRefs = { owner: 'o', repo: 'r', baseSha: 'BASE', headSha: 'HEAD' }

const enc = (s: string) => new TextEncoder().encode(s)

/** Minimal Response stand-in for a raw blob fetch. */
const rawResponse = (bytes: Uint8Array, contentLength?: string) =>
  ({
    ok: true,
    status: 200,
    headers: {
      get: (h: string) =>
        h.toLowerCase() === 'content-length'
          ? (contentLength ?? String(bytes.length))
          : null,
    },
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }) as unknown as Response

/** A canned single-hunk result so we can assert formatting without jsdiff. */
const oneHunk: Hunk = {
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 1,
  lines: ['-old', '+new'],
}
const cannedHunks: ComputeHunks = vi.fn(() => [oneHunk])

describe('looksBinary', () => {
  it('treats a NUL byte as binary', () => {
    expect(looksBinary(new Uint8Array([0x68, 0x00, 0x69]))).toBe(true)
  })
  it('treats plain UTF-8 text as not binary', () => {
    expect(looksBinary(enc('hello\nworld\n'))).toBe(false)
  })
})

describe('buildFileDiff', () => {
  it('diffs a modified file: fetches both sides and formats the hunks', async () => {
    const computeHunks = vi.fn(() => [oneHunk])
    const doFetch = vi.fn(async (url: string) =>
      rawResponse(enc(String(url).includes('ref=BASE') ? 'old\n' : 'new\n')),
    ) as unknown as typeof fetch
    const out = await buildFileDiff(
      { path: 'src/app.ts', status: 'modified' },
      refs,
      'tok',
      { fetch: doFetch, computeHunks },
    )
    expect(out).toBe(
      [
        'diff --git a/src/app.ts b/src/app.ts',
        '--- a/src/app.ts',
        '+++ b/src/app.ts',
        '@@ -1,1 +1,1 @@',
        '-old',
        '+new',
      ].join('\n'),
    )
    expect(computeHunks).toHaveBeenCalledWith('old\n', 'new\n')
    // base side fetched at BASE, head side at HEAD
    const urls = (doFetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(urls).toHaveLength(2)
    expect(urls.some((u) => String(u).includes('ref=BASE'))).toBe(true)
    expect(urls.some((u) => String(u).includes('ref=HEAD'))).toBe(true)
  })

  it('hits the contents endpoint with the raw Accept and bearer token', async () => {
    const doFetch = vi.fn(async () => rawResponse(enc('x\n'))) as unknown as typeof fetch
    await buildFileDiff({ path: 'a b/c.ts', status: 'added' }, refs, 'tok', {
      fetch: doFetch,
      computeHunks: cannedHunks,
    })
    const [url, init] = (doFetch as ReturnType<typeof vi.fn>).mock.calls[0]
    // path segments are percent-encoded, slashes preserved
    expect(url).toBe('https://api.github.com/repos/o/r/contents/a%20b/c.ts?ref=HEAD')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Accept).toBe('application/vnd.github.raw')
    expect(headers.Authorization).toBe('Bearer tok')
  })

  it('formats an added file against /dev/null, fetching only the head side', async () => {
    const computeHunks = vi.fn(() => [oneHunk])
    const doFetch = vi.fn(async () =>
      rawResponse(enc('new\n')),
    ) as unknown as typeof fetch
    const out = await buildFileDiff({ path: 'new.ts', status: 'added' }, refs, 'tok', {
      fetch: doFetch,
      computeHunks,
    })
    expect(out).toContain('new file mode 100644')
    expect(out).toContain('--- /dev/null')
    expect(out).toContain('+++ b/new.ts')
    expect((doFetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
    expect(computeHunks).toHaveBeenCalledWith('', 'new\n')
  })

  it('formats a removed file against /dev/null, fetching only the base side', async () => {
    const computeHunks = vi.fn(() => [oneHunk])
    const doFetch = vi.fn(async () =>
      rawResponse(enc('gone\n')),
    ) as unknown as typeof fetch
    const out = await buildFileDiff({ path: 'gone.ts', status: 'removed' }, refs, 'tok', {
      fetch: doFetch,
      computeHunks,
    })
    expect(out).toContain('deleted file mode 100644')
    expect(out).toContain('--- a/gone.ts')
    expect(out).toContain('+++ /dev/null')
    expect((doFetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
    expect(computeHunks).toHaveBeenCalledWith('gone\n', '')
  })

  it('degrades a binary file to a Binary-files marker without diffing', async () => {
    const computeHunks = vi.fn(() => [oneHunk])
    const doFetch = vi.fn(async () =>
      rawResponse(new Uint8Array([0x89, 0x50, 0x00, 0x4e])),
    ) as unknown as typeof fetch
    const out = await buildFileDiff(
      { path: 'logo.png', status: 'modified' },
      refs,
      'tok',
      {
        fetch: doFetch,
        computeHunks,
      },
    )
    expect(out).toBe(
      'diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ',
    )
    expect(computeHunks).not.toHaveBeenCalled()
  })

  it('degrades an oversize file (by content-length) without reading the body', async () => {
    const computeHunks = vi.fn(() => [oneHunk])
    const arrayBuffer = vi.fn()
    const doFetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: {
            get: (h: string) => (h.toLowerCase() === 'content-length' ? '999999' : null),
          },
          arrayBuffer,
        }) as unknown as Response,
    ) as unknown as typeof fetch
    const out = await buildFileDiff(
      { path: 'big.json', status: 'modified' },
      refs,
      'tok',
      {
        fetch: doFetch,
        computeHunks,
        maxBytes: 1000,
      },
    )
    expect(out).toContain('Binary files a/big.json and b/big.json differ')
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(computeHunks).not.toHaveBeenCalled()
  })

  it('degrades a failed fetch (non-ok) to a marker rather than throwing', async () => {
    const doFetch = vi.fn(
      async () => ({ ok: false, status: 403 }) as Response,
    ) as unknown as typeof fetch
    const out = await buildFileDiff({ path: 'x.ts', status: 'modified' }, refs, 'tok', {
      fetch: doFetch,
      computeHunks: cannedHunks,
    })
    expect(out).toContain('Binary files a/x.ts and b/x.ts differ')
  })

  it('degrades a thrown fetch (network error) to a marker rather than throwing', async () => {
    const doFetch = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const out = await buildFileDiff({ path: 'x.ts', status: 'modified' }, refs, 'tok', {
      fetch: doFetch,
      computeHunks: cannedHunks,
    })
    expect(out).toContain('Binary files a/x.ts and b/x.ts differ')
  })
})
