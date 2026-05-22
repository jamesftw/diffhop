/**
 * MAIN-world content script for diffshub.com.
 *
 * Patches window.fetch so DiffsHub's client-side `/api/diff` request is served
 * by the extension (which holds the GitHub token and does the authenticated API
 * call) instead of DiffsHub's own backend. Runs in the page's JS world (so it
 * can patch the fetch DiffsHub actually calls); it never sees the token — it
 * relays the request to the isolated content script via postMessage and gets
 * back only the diff text. Falls back to the original fetch if the extension
 * declines (e.g. not signed in), so public repos still work natively.
 */
const TAG = 'diffhop';
const origFetch = window.fetch;
const pending = new Map<number, (data: { ok: boolean; status?: number; body?: string }) => void>();
let nextId = 1;

window.addEventListener('message', (e) => {
  if (e.source !== window || (e.data as { __tag?: string })?.__tag !== TAG) return;
  const data = e.data as { __tag: string; dir: string; id: number; ok: boolean; status?: number; body?: string };
  if (data.dir !== 'response') return;
  const resolve = pending.get(data.id);
  if (resolve) {
    pending.delete(data.id);
    resolve(data);
  }
});

window.fetch = function (this: typeof window, input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url && url.includes('/api/diff?path=')) {
    return new Promise<Response>((resolve) => {
      const id = nextId++;
      pending.set(id, (data) => {
        if (data.ok) {
          resolve(
            new Response(data.body ?? '', {
              status: data.status ?? 200,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            }),
          );
        } else {
          // Extension declined (not signed in / disabled) — let DiffsHub handle it.
          resolve(origFetch.call(window, input, init));
        }
      });
      window.postMessage({ __tag: TAG, dir: 'request', id, url }, '*');
    });
  }
  return origFetch.call(window, input, init);
};
