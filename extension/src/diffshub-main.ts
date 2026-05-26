/**
 * diffshub.com MAIN-world content script. Patches window.fetch for DiffsHub's
 * `/api/diff` request.
 *
 * Public repos: DiffsHub's own backend already serves the diff fast and
 * streamed, so we let the native fetch handle them — going through the GitHub
 * `.diff` API instead would be slower (high time-to-first-byte for big diffs).
 * Only when that backend can't serve the diff (a private repo → non-OK
 * response) do we fall back to the extension, which streams it from the GitHub
 * API with the user's token over a port; we reassemble those chunks into a
 * streaming Response so DiffsHub still renders progressively. The token never
 * enters the page.
 */
import { BRIDGE_TAG } from './lib/config'
import { isBridgeMessage } from './lib/messages'

const origFetch = window.fetch

interface StreamHandler {
  onHead(ok: boolean, status?: number): void
  onChunk(bytes: ArrayBuffer): void
  onEnd(): void
  onError(): void
}
const handlers = new Map<number, StreamHandler>()
let nextId = 1

window.addEventListener('message', (event) => {
  if (event.source !== window || !isBridgeMessage(event.data)) return
  const message = event.data
  const handler = handlers.get(message.id)
  if (!handler) return
  if (message.dir === 'head') handler.onHead(message.ok, message.status)
  else if (message.dir === 'chunk') handler.onChunk(message.bytes)
  else if (message.dir === 'end') handler.onEnd()
  else if (message.dir === 'error') handler.onError()
})

/**
 * Stream the diff through the extension (GitHub API + the user's token). Resolves
 * to a streaming Response, or `null` if the extension declines (disabled / signed
 * out / unmappable) or fails before sending headers — in which case the caller
 * serves DiffsHub's own response instead.
 */
function streamViaExtension(url: string): Promise<Response | null> {
  return new Promise((resolve) => {
    const id = nextId++
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    let settled = false
    let closed = false
    const cleanup = (): void => void handlers.delete(id)

    handlers.set(id, {
      onHead(ok, status) {
        if (settled) return
        settled = true
        if (!ok) {
          cleanup()
          return resolve(null) // declined → caller uses DiffsHub's response
        }
        const stream = new ReadableStream<Uint8Array>({
          start(streamController) {
            controller = streamController
          },
          cancel() {
            // Page aborted the body (e.g. navigated to another diff): close the
            // port so the background aborts the upstream GitHub fetch.
            window.postMessage({ __tag: BRIDGE_TAG, dir: 'cancel', id }, '*')
            cleanup()
          },
        })
        resolve(
          new Response(stream, {
            status: status ?? 200,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          }),
        )
      },
      onChunk(bytes) {
        if (closed) return
        try {
          controller?.enqueue(new Uint8Array(bytes))
        } catch {
          /* stream already closed/cancelled */
        }
      },
      onEnd() {
        closed = true
        cleanup()
        try {
          controller?.close()
        } catch {
          /* already closed */
        }
      },
      onError() {
        closed = true
        if (!settled) {
          settled = true
          cleanup()
          return resolve(null) // failed before head → caller falls back
        }
        cleanup()
        try {
          controller?.error(new Error('diff stream failed'))
        } catch {
          /* already closed */
        }
      },
    })

    window.postMessage({ __tag: BRIDGE_TAG, dir: 'request', id, url }, '*')
  })
}

/**
 * Serve a /api/diff request: try DiffsHub's own backend first (fast + streamed,
 * the right path for public repos), and only fall back to the extension's
 * authenticated GitHub stream when the backend can't serve it (private repo →
 * non-OK response).
 */
async function serveDiff(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  url: string,
): Promise<Response> {
  let native: Response | null = null
  try {
    native = await origFetch.call(window, input, init)
    if (native.ok) return native // DiffsHub served it (public) — fast, streamed
  } catch {
    native = null // network error on the native path; try the extension instead
  }
  // DiffsHub couldn't serve it (private repo) → stream via the extension.
  const streamed = await streamViaExtension(url)
  if (streamed) return streamed
  // Extension declined (disabled / signed out): serve DiffsHub's own response.
  return native ?? origFetch.call(window, input, init)
}

window.fetch = function (
  this: typeof window,
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url || !url.includes('/api/diff?path=')) {
    return origFetch.call(window, input, init)
  }
  return serveDiff(input, init, url)
}
