import { describe, it, expect, vi } from 'vitest';
import { handleDiffRequest } from '../proxy/src/server';

const DIFF_BODY = 'diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n';

function mockFetch(status = 200, body = DIFF_BODY) {
  return vi.fn(async () => ({
    status,
    async text() {
      return body;
    },
  })) as unknown as typeof fetch;
}

const deps = (fetchImpl: typeof fetch, pat = 'ghp_secret') => ({ fetch: fetchImpl, pat });

describe('handleDiffRequest', () => {
  it('fetches the GitHub .diff with a bearer token and returns it verbatim', async () => {
    const fetch = mockFetch();
    const res = await handleDiffRequest('GET', '/api/diff?path=/o/r/pull/1', deps(fetch));

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe('https://github.com/o/r/pull/1.diff');
    expect(init.headers.Authorization).toBe('Bearer ghp_secret');

    expect(res.status).toBe(200);
    expect(res.body).toBe(DIFF_BODY);
    expect(res.headers['Content-Type']).toBe('text/plain; charset=utf-8');
  });

  it('sets the DiffsHub CORS origin on the response', async () => {
    const res = await handleDiffRequest('GET', '/api/diff?path=/o/r/pull/1', deps(mockFetch()));
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://diffshub.com');
  });

  it('strips an existing .diff/.patch suffix before appending .diff', async () => {
    const fetch = mockFetch();
    await handleDiffRequest('GET', '/api/diff?path=/o/r/pull/1.diff', deps(fetch));
    expect((fetch as any).mock.calls[0][0]).toBe('https://github.com/o/r/pull/1.diff');

    const fetch2 = mockFetch();
    await handleDiffRequest('GET', '/api/diff?path=/o/r/pull/1.patch', deps(fetch2));
    expect((fetch2 as any).mock.calls[0][0]).toBe('https://github.com/o/r/pull/1.diff');
  });

  it('answers OPTIONS preflight with CORS headers and no upstream fetch', async () => {
    const fetch = mockFetch();
    const res = await handleDiffRequest('OPTIONS', '/api/diff?path=/o/r/pull/1', deps(fetch));
    expect(res.status).toBe(204);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://diffshub.com');
    expect(res.headers['Access-Control-Allow-Methods']).toContain('GET');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns 400 when the path query parameter is missing', async () => {
    const fetch = mockFetch();
    const res = await handleDiffRequest('GET', '/api/diff', deps(fetch));
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns 404 for non /api/diff paths', async () => {
    const res = await handleDiffRequest('GET', '/elsewhere', deps(mockFetch()));
    expect(res.status).toBe(404);
  });

  it('returns 405 for non-GET methods', async () => {
    const fetch = mockFetch();
    const res = await handleDiffRequest('POST', '/api/diff?path=/o/r/pull/1', deps(fetch));
    expect(res.status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes through GitHub error statuses (401/404)', async () => {
    const res401 = await handleDiffRequest('GET', '/api/diff?path=/o/r/pull/1', deps(mockFetch(401, 'Bad credentials')));
    expect(res401.status).toBe(401);
    expect(res401.body).toBe('Bad credentials');

    const res404 = await handleDiffRequest('GET', '/api/diff?path=/o/r/pull/1', deps(mockFetch(404, 'Not Found')));
    expect(res404.status).toBe(404);
  });

  it('omits the Authorization header when no PAT is configured', async () => {
    const fetch = mockFetch();
    await handleDiffRequest('GET', '/api/diff?path=/o/r/pull/1', deps(fetch, ''));
    expect((fetch as any).mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});
