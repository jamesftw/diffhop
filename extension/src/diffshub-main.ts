/**
 * diffshub.com MAIN-world content script. Patches window.fetch so DiffsHub's
 * `/api/diff` request is served by the extension instead of its own backend. It
 * never sees the token: it relays the request to the isolated script via
 * postMessage and gets back only the diff. Falls back to the real fetch when the
 * extension declines, so public repos still resolve natively.
 */
import { BRIDGE_TAG } from './lib/config'
import { isBridgeMessage, type DiffResponse, type BridgeRequest } from './lib/messages'

const origFetch = window.fetch
const pending = new Map<number, (data: DiffResponse) => void>()
let nextId = 1

window.addEventListener('message', (e) => {
  if (e.source !== window || !isBridgeMessage(e.data) || e.data.dir !== 'response') return
  const resolve = pending.get(e.data.id)
  if (resolve) {
    pending.delete(e.data.id)
    resolve(e.data)
  }
})

window.fetch = function (
  this: typeof window,
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url && url.includes('/api/diff?path=')) {
    return new Promise<Response>((resolve) => {
      const id = nextId++
      pending.set(id, (data) => {
        if (data.ok) {
          resolve(
            new Response(data.body ?? '', {
              status: data.status ?? 200,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            }),
          )
        } else {
          // Extension declined (not signed in / disabled); let DiffsHub handle it.
          resolve(origFetch.call(window, input, init))
        }
      })
      const request: BridgeRequest = { __tag: BRIDGE_TAG, dir: 'request', id, url }
      window.postMessage(request, '*')
    })
  }
  return origFetch.call(window, input, init)
}
