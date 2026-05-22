import { describe, it, expect, vi } from 'vitest'
import { fetchDiff, type DiffServiceDeps } from '../extension/src/lib/diff-service'

const textRes = (status: number, body: string) =>
  ({ status, text: async () => body }) as Response

function makeDeps(over: Partial<DiffServiceDeps> = {}): DiffServiceDeps {
  return {
    isEnabled: vi.fn(async () => true),
    getToken: vi.fn(async () => 'gho_tok'),
    fetch: vi.fn(async () => textRes(200, 'diff --git a b')) as unknown as typeof fetch,
    ...over,
  }
}

const API_DIFF = '/api/diff?path=%2Fo%2Fr%2Fpull%2F5'

describe('fetchDiff', () => {
  it('declines (ok:false) and does not fetch when disabled', async () => {
    const deps = makeDeps({ isEnabled: vi.fn(async () => false) })
    expect(await fetchDiff(API_DIFF, deps)).toEqual({ ok: false })
    expect(deps.fetch).not.toHaveBeenCalled()
  })

  it('declines when signed out (empty/whitespace token)', async () => {
    expect(
      await fetchDiff(API_DIFF, makeDeps({ getToken: vi.fn(async () => '') })),
    ).toEqual({
      ok: false,
    })
    expect(
      await fetchDiff(API_DIFF, makeDeps({ getToken: vi.fn(async () => '   ') })),
    ).toEqual({
      ok: false,
    })
  })

  it('declines when the path is not a diff URL', async () => {
    const deps = makeDeps()
    expect(await fetchDiff('/api/diff?path=%2Fo%2Fr', deps)).toEqual({ ok: false })
    expect(deps.fetch).not.toHaveBeenCalled()
  })

  it('resolves the GitHub API URL, sends the token, and returns status + body', async () => {
    const deps = makeDeps()
    const res = await fetchDiff(API_DIFF, deps)
    expect(res).toEqual({ ok: true, status: 200, body: 'diff --git a b' })
    const [url, init] = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/o/r/pulls/5')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gho_tok')
    expect((init.headers as Record<string, string>).Accept).toBe(
      'application/vnd.github.diff',
    )
  })

  it('passes through non-200 status and body', async () => {
    const deps = makeDeps({
      fetch: vi.fn(async () => textRes(404, 'Not Found')) as unknown as typeof fetch,
    })
    expect(await fetchDiff(API_DIFF, deps)).toEqual({
      ok: true,
      status: 404,
      body: 'Not Found',
    })
  })
})
