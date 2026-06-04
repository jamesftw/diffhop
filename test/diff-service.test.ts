import { describe, it, expect, vi } from 'vitest'
import {
  streamDiff,
  type DiffServiceDeps,
  type DiffSink,
} from '../extension/src/lib/diff-service'

const enc = new TextEncoder()
const dec = new TextDecoder()

/** A fake fetch Response whose body streams the given string chunks. */
function streamRes(status: number, chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const s of chunks) c.enqueue(enc.encode(s))
      c.close()
    },
  })
  return { status, body, text: async () => chunks.join('') } as unknown as Response
}

function makeDeps(over: Partial<DiffServiceDeps> = {}): DiffServiceDeps {
  return {
    isEnabled: vi.fn(async () => true),
    getToken: vi.fn(async () => 'gho_tok'),
    fetch: vi.fn(async () => streamRes(200, ['x'])) as unknown as typeof fetch,
    ...over,
  }
}

/** Collect sink calls as ['head',ok,status] / ['chunk',text] / ['end'] / ['error']. */
function makeSink() {
  const events: unknown[][] = []
  const sink: DiffSink = {
    head: (ok, status) => void events.push(['head', ok, status]),
    chunk: (b) => void events.push(['chunk', dec.decode(b)]),
    end: () => void events.push(['end']),
    error: () => void events.push(['error']),
  }
  return { events, sink }
}

const API_DIFF = '/api/diff?path=%2Fo%2Fr%2Fpull%2F5'

describe('streamDiff', () => {
  it('streams head, body chunks in order, then end', async () => {
    const deps = makeDeps({
      fetch: vi.fn(async () =>
        streamRes(200, ['a', 'b', 'c']),
      ) as unknown as typeof fetch,
    })
    const { events, sink } = makeSink()
    await streamDiff(API_DIFF, deps, sink)
    expect(events).toEqual([
      ['head', true, 200],
      ['chunk', 'a'],
      ['chunk', 'b'],
      ['chunk', 'c'],
      ['end'],
    ])
  })

  it('resolves the GitHub API URL and sends the token + diff media type', async () => {
    const fetch = vi.fn(async () => streamRes(200, ['x']))
    const { sink } = makeSink()
    await streamDiff(
      API_DIFF,
      makeDeps({ fetch: fetch as unknown as typeof fetch }),
      sink,
    )
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/o/r/pulls/5')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gho_tok')
    expect((init.headers as Record<string, string>).Accept).toBe(
      'application/vnd.github.diff',
    )
  })

  it('declines (head ok:false) and does not fetch when disabled', async () => {
    const deps = makeDeps({ isEnabled: vi.fn(async () => false) })
    const { events, sink } = makeSink()
    await streamDiff(API_DIFF, deps, sink)
    expect(events).toEqual([['head', false, undefined]])
    expect(deps.fetch).not.toHaveBeenCalled()
  })

  it('declines when signed out (empty / whitespace token)', async () => {
    for (const tok of ['', '   ']) {
      const deps = makeDeps({ getToken: vi.fn(async () => tok) })
      const { events, sink } = makeSink()
      await streamDiff(API_DIFF, deps, sink)
      expect(events).toEqual([['head', false, undefined]])
      expect(deps.fetch).not.toHaveBeenCalled()
    }
  })

  it('declines when the path is not a diff URL', async () => {
    const deps = makeDeps()
    const { events, sink } = makeSink()
    await streamDiff('/api/diff?path=%2Fo%2Fr', deps, sink)
    expect(events).toEqual([['head', false, undefined]])
    expect(deps.fetch).not.toHaveBeenCalled()
  })

  it('passes a non-200 status through and still streams the body', async () => {
    const deps = makeDeps({
      fetch: vi.fn(async () => streamRes(404, ['Not Found'])) as unknown as typeof fetch,
    })
    const { events, sink } = makeSink()
    await streamDiff(API_DIFF, deps, sink)
    expect(events).toEqual([['head', true, 404], ['chunk', 'Not Found'], ['end']])
  })

  it('on 406 too_large, falls back to the files listing and emits one rebuilt chunk', async () => {
    const filesPage = {
      ok: true,
      status: 200,
      json: async () => [
        { filename: 'a.ts', status: 'modified', patch: '@@ -1 +1 @@\n-1\n+2' },
      ],
      headers: { get: () => null },
    } as unknown as Response
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(streamRes(406, ['{"message":"too_large"}']))
      .mockResolvedValueOnce(filesPage)
    const { events, sink } = makeSink()
    await streamDiff(
      API_DIFF,
      makeDeps({ fetch: fetch as unknown as typeof fetch }),
      sink,
    )
    expect(events[0]).toEqual(['head', true, 200])
    expect(events[1][0]).toBe('chunk')
    expect(events[1][1]).toContain('diff --git a/a.ts b/a.ts')
    expect(events[2]).toEqual(['end'])
    expect(fetch.mock.calls[1][0]).toBe(
      'https://api.github.com/repos/o/r/pulls/5/files?per_page=100',
    )
  })

  it('Tier 3: serves an authored message (not the raw 406) for an unrecoverable compare', async () => {
    const fetch = vi.fn(async () => streamRes(406, ['{"message":"too_large"}']))
    const { events, sink } = makeSink()
    await streamDiff(
      '/api/diff?path=%2Fo%2Fr%2Fcompare%2Fmain...x',
      makeDeps({ fetch: fetch as unknown as typeof fetch }),
      sink,
    )
    expect(events[0]).toEqual(['head', true, 200])
    expect(events[1][0]).toBe('chunk')
    expect(events[1][1]).toContain("too large for GitHub's API")
    expect(events[1][1]).toContain('https://github.com/o/r/compare/main...x')
    expect(events[1][1]).not.toContain('too_large') // never the raw GitHub body
    expect(events[2]).toEqual(['end'])
  })

  it('Tier 3: authored message when neither the files listing nor the trees path can serve it', async () => {
    // 406 → files 403 → escalate → trees refs all blocked → authored message,
    // never GitHub's raw 406 body.
    const doFetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      const accept = String((init?.headers as Record<string, string>)?.Accept ?? '')
      if (u.endsWith('/pulls/5') && accept.includes('diff'))
        return streamRes(406, ['too_large'])
      return { ok: false, status: 403 } as Response // files, refs, and pulls-json blocked
    })
    const { events, sink } = makeSink()
    await streamDiff(
      API_DIFF,
      makeDeps({ fetch: doFetch as unknown as typeof fetch }),
      sink,
    )
    expect(events[0]).toEqual(['head', true, 200])
    expect(events[1][1]).toContain("too large for GitHub's API")
    expect(events[1][1]).not.toContain('too_large')
    expect(events[events.length - 1]).toEqual(['end'])
  })

  it('emits error when the fetch rejects before head (e.g. aborted)', async () => {
    const fetch = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError')
    })
    const { events, sink } = makeSink()
    await streamDiff(
      API_DIFF,
      makeDeps({ fetch: fetch as unknown as typeof fetch }),
      sink,
    )
    expect(events).toEqual([['error']])
  })

  it('aborts mid-stream: head + the chunk already read, then error (no truncated end)', async () => {
    const controller = new AbortController()
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('partial'))
      },
      pull() {
        // Block until aborted, mimicking fetch tearing down the body stream.
        return new Promise<void>((_, reject) => {
          controller.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        })
      },
    })
    const res = { status: 200, body, text: async () => 'partial' } as unknown as Response
    const deps = makeDeps({
      fetch: vi.fn(async () => res) as unknown as typeof fetch,
      signal: controller.signal,
    })
    const { events, sink } = makeSink()
    const p = streamDiff(API_DIFF, deps, sink)
    await new Promise((r) => setTimeout(r, 0)) // let head + first chunk flush
    controller.abort()
    await p
    expect(events[0]).toEqual(['head', true, 200])
    expect(events).toContainEqual(['chunk', 'partial'])
    expect(events[events.length - 1]).toEqual(['error'])
    expect(events).not.toContainEqual(['end'])
  })

  // --- Tier 2: Git Trees + blob-diff (the 20k-line cap) --------------------

  const tooLargeBody = {
    message: 'Sorry, the diff exceeded the maximum number of lines (20000)',
    errors: [{ code: 'too_large' }],
    status: '406',
  }
  const jsonRes = (body: unknown) =>
    ({
      ok: true,
      status: 200,
      json: async () => body,
      headers: { get: () => null },
    }) as unknown as Response
  const errPage = (status: number, body: unknown) =>
    ({ ok: false, status, json: async () => body }) as unknown as Response
  const rawRes = (text: string) => {
    const b = enc.encode(text)
    return {
      ok: true,
      status: 200,
      headers: {
        get: (h: string) =>
          h.toLowerCase() === 'content-length' ? String(b.length) : null,
      },
      arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    } as unknown as Response
  }
  const blobEntry = (path: string, sha: string) => ({ path, type: 'blob', sha })

  /**
   * A mock walking the whole ladder for PR #5: diff 406 → files 403 → escalate →
   * resolve refs contents-only (head=H, merge=M whose parents are [BTIP, H],
   * merge-base MB from compare) → trees(MB, H) → blobs. `trees` is keyed by the
   * resolved base/head SHAs ('MB' and 'H'); `blobs` by `path@ref`.
   */
  function ladderFetch(
    trees: Record<string, { tree: unknown[]; truncated?: boolean }>,
    blobs: Record<string, string>,
  ) {
    return vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      const accept = String((init?.headers as Record<string, string>)?.Accept ?? '')
      if (u === 'https://api.github.com/repos/o/r/pulls/5' && accept.includes('diff'))
        return streamRes(406, ['{"errors":[{"code":"too_large"}]}'])
      if (u === 'https://api.github.com/repos/o/r/pulls/5/files?per_page=100')
        return errPage(403, tooLargeBody)
      if (u.endsWith('/git/ref/pull/5/head')) return jsonRes({ object: { sha: 'H' } })
      if (u.endsWith('/git/ref/pull/5/merge')) return jsonRes({ object: { sha: 'M' } })
      if (u.endsWith('/git/commits/M'))
        return jsonRes({ parents: [{ sha: 'BTIP' }, { sha: 'H' }] })
      if (u.includes('/compare/')) return jsonRes({ merge_base_commit: { sha: 'MB' } })
      const treeSha = /\/git\/trees\/([^?]+)/.exec(u)?.[1]
      if (treeSha) return jsonRes(trees[treeSha])
      const raw = /\/contents\/(.+)\?ref=(.+)$/.exec(u)
      if (raw) return rawRes(blobs[`${decodeURIComponent(raw[1])}@${raw[2]}`] ?? '')
      throw new Error('unexpected url ' + u)
    })
  }

  /** Concatenate all chunk payloads from a collected event list. */
  const chunkText = (events: unknown[][]) =>
    events
      .filter((e) => e[0] === 'chunk')
      .map((e) => e[1])
      .join('')

  it('Tier 2: rebuilds a modified file from its blobs and streams real hunks', async () => {
    const doFetch = ladderFetch(
      { MB: { tree: [blobEntry('a.ts', '1')] }, H: { tree: [blobEntry('a.ts', '2')] } },
      { 'a.ts@MB': 'old\n', 'a.ts@H': 'new\n' },
    )
    const { events, sink } = makeSink()
    await streamDiff(
      API_DIFF,
      makeDeps({ fetch: doFetch as unknown as typeof fetch }),
      sink,
    )
    expect(events[0]).toEqual(['head', true, 200])
    const text = chunkText(events)
    expect(text).toContain('diff --git a/a.ts b/a.ts')
    expect(text).toContain('--- a/a.ts')
    expect(text).toContain('+++ b/a.ts')
    expect(text).toContain('-old')
    expect(text).toContain('+new')
    expect(text).not.toContain('too_large') // never the raw GitHub body
    expect(events[events.length - 1]).toEqual(['end'])
  })

  it('Tier 2: streams one chunk per file, in path order', async () => {
    const doFetch = ladderFetch(
      {
        MB: { tree: [blobEntry('a.ts', '1'), blobEntry('b.ts', '1')] },
        H: { tree: [blobEntry('a.ts', '2'), blobEntry('b.ts', '2')] },
      },
      { 'a.ts@MB': 'oa\n', 'a.ts@H': 'na\n', 'b.ts@MB': 'ob\n', 'b.ts@H': 'nb\n' },
    )
    const { events, sink } = makeSink()
    await streamDiff(
      API_DIFF,
      makeDeps({ fetch: doFetch as unknown as typeof fetch }),
      sink,
    )
    const chunks = events.filter((e) => e[0] === 'chunk').map((e) => String(e[1]))
    const aIdx = chunks.findIndex((c) => c.includes('a/a.ts'))
    const bIdx = chunks.findIndex((c) => c.includes('a/b.ts'))
    expect(aIdx).toBeGreaterThanOrEqual(0)
    expect(bIdx).toBeGreaterThan(aIdx) // a.ts emitted before b.ts
  })

  it('Tier 3: a truncated tree falls back to the authored message', async () => {
    const doFetch = ladderFetch(
      { MB: { tree: [] }, H: { tree: [blobEntry('a.ts', '2')], truncated: true } },
      {},
    )
    const { events, sink } = makeSink()
    await streamDiff(
      API_DIFF,
      makeDeps({ fetch: doFetch as unknown as typeof fetch }),
      sink,
    )
    expect(events[0]).toEqual(['head', true, 200])
    expect(chunkText(events)).toContain("too large for GitHub's API")
    expect(events[events.length - 1]).toEqual(['end'])
  })

  it('Tier 2: binds the abort signal to the blob fetches', async () => {
    const controller = new AbortController()
    const doFetch = ladderFetch(
      { MB: { tree: [blobEntry('a.ts', '1')] }, H: { tree: [blobEntry('a.ts', '2')] } },
      { 'a.ts@MB': 'old\n', 'a.ts@H': 'new\n' },
    )
    const { sink } = makeSink()
    await streamDiff(
      API_DIFF,
      makeDeps({ fetch: doFetch as unknown as typeof fetch, signal: controller.signal }),
      sink,
    )
    const blobCall = doFetch.mock.calls.find((c) => String(c[0]).includes('/contents/'))
    expect(blobCall).toBeDefined()
    expect((blobCall![1] as RequestInit).signal).toBe(controller.signal)
  })
})
