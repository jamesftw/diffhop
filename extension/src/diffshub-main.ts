/**
 * diffshub.com MAIN-world content script. Patches window.fetch so DiffsHub's
 * `/api/diff` request is served by the extension instead of its own backend. It
 * never sees the token: it relays the request to the isolated script, which
 * streams the diff back over a port; here we reassemble those chunks into a
 * streaming Response so DiffsHub renders it progressively, just like its native
 * fetch. Falls back to the real fetch when the extension declines (signed out /
 * disabled / unmappable), so public repos still resolve natively.
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

window.addEventListener('message', (e) => {
  if (e.source !== window || !isBridgeMessage(e.data)) return
  const m = e.data
  const h = handlers.get(m.id)
  if (!h) return
  if (m.dir === 'head') h.onHead(m.ok, m.status)
  else if (m.dir === 'chunk') h.onChunk(m.bytes)
  else if (m.dir === 'end') h.onEnd()
  else if (m.dir === 'error') h.onError()
})

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

  return new Promise<Response>((resolve) => {
    const id = nextId++
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    let settled = false
    let closed = false
    const cleanup = (): void => void handlers.delete(id)
    const fallback = (): void => {
      settled = true
      cleanup()
      resolve(origFetch.call(window, input, init))
    }

    handlers.set(id, {
      onHead(ok, status) {
        if (settled) return
        if (!ok) return fallback() // extension declined → DiffsHub's own backend
        settled = true
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c
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
        if (!settled) return fallback() // failed before head → fall back
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
