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

  it('streams the original 406 body when the fallback yields nothing (compare)', async () => {
    const fetch = vi.fn(async () => streamRes(406, ['too_large']))
    const { events, sink } = makeSink()
    await streamDiff(
      '/api/diff?path=%2Fo%2Fr%2Fcompare%2Fmain...x',
      makeDeps({ fetch: fetch as unknown as typeof fetch }),
      sink,
    )
    expect(events).toEqual([['head', true, 406], ['chunk', 'too_large'], ['end']])
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
})
