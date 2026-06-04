/**
 * Content script for diffshub.com (isolated world). Two jobs:
 *  1. Bridge the MAIN-world fetch patch (diffshub-main.ts) to the background:
 *     relay /api/diff requests so the background does the authenticated GitHub
 *     API call, and post the diff back. The token never enters the page.
 *  2. Tag DiffsHub's "View on GitHub" links with the SKIP_PARAM escape marker.
 */
import { matchGitHubDiffUrl } from './urls'
import { SKIP_PARAM, BRIDGE_TAG, DIFF_STREAM_PORT } from './lib/config'
import {
  isBridgeMessage,
  type BridgeMessage,
  type DiffPortOutbound,
} from './lib/messages'
import { extensionAlive } from './lib/runtime'
import { base64ToBytes } from './lib/bytes'

// Bridge: MAIN world ↔ background, streamed over a per-request port. One MAIN
// "request" opens a port; the background streams head → chunk* → end|error back,
// which we relay to MAIN. A MAIN "cancel" (page aborted the body) closes the port.
const ports = new Map<number, chrome.runtime.Port>()

/** Post a bridge message to the MAIN world, optionally transferring buffers. */
function toMain(msg: BridgeMessage, transfer: Transferable[] = []): void {
  window.postMessage(msg, '*', transfer)
}

function startStream(id: number, url: string): void {
  let port: chrome.runtime.Port
  try {
    port = chrome.runtime.connect({ name: DIFF_STREAM_PORT })
  } catch {
    toMain({ __tag: BRIDGE_TAG, dir: 'head', id, ok: false }) // context invalidated
    return
  }
  ports.set(id, port)
  let terminated = false

  // Drop the stream and close the port. Disconnecting lets the background's
  // AbortController fire and the service worker suspend; leaving ports open
  // would pin the worker awake and accumulate one dead port per diff.
  function finish(): void {
    terminated = true
    ports.delete(id)
    try {
      port.disconnect()
    } catch {
      /* already gone */
    }
  }

  port.onMessage.addListener((reply: DiffPortOutbound) => {
    if (reply.type === 'head') {
      toMain({ __tag: BRIDGE_TAG, dir: 'head', id, ok: reply.ok, status: reply.status })
      if (!reply.ok) finish() // declined: nothing follows
    } else if (reply.type === 'chunk') {
      // The port hop JSON-serializes, so chunks arrive base64-encoded (see
      // lib/bytes.ts). Decode to a fresh Uint8Array and hand MAIN its backing
      // ArrayBuffer as a transfer (offset 0, exact length — no copy needed).
      const buffer = base64ToBytes(reply.bytes).buffer as ArrayBuffer
      toMain({ __tag: BRIDGE_TAG, dir: 'chunk', id, bytes: buffer }, [buffer])
    } else if (reply.type === 'end') {
      toMain({ __tag: BRIDGE_TAG, dir: 'end', id })
      finish()
    } else if (reply.type === 'error') {
      toMain({ __tag: BRIDGE_TAG, dir: 'error', id })
      finish()
    }
  })

  port.onDisconnect.addListener(() => {
    ports.delete(id)
    if (!terminated) toMain({ __tag: BRIDGE_TAG, dir: 'error', id }) // SW died mid-stream
  })

  try {
    port.postMessage({ type: 'start', url })
  } catch {
    // Context invalidated between connect() and start: fall back, don't hang.
    finish()
    toMain({ __tag: BRIDGE_TAG, dir: 'head', id, ok: false })
  }
}

window.addEventListener('message', (e) => {
  if (e.source !== window || !isBridgeMessage(e.data)) return
  const data = e.data
  if (data.dir === 'request') {
    // After an extension reload this stale relay's chrome handle is dead; tell
    // MAIN to fall back to DiffsHub's own fetch instead of throwing.
    if (!extensionAlive()) {
      toMain({ __tag: BRIDGE_TAG, dir: 'head', id: data.id, ok: false })
      return
    }
    startStream(data.id, data.url)
  } else if (data.dir === 'cancel') {
    const port = ports.get(data.id)
    if (port) {
      ports.delete(data.id)
      try {
        port.postMessage({ type: 'cancel' })
        port.disconnect()
      } catch {
        /* already gone */
      }
    }
  }
})

function tagLink(a: HTMLAnchorElement): void {
  if (!a.href.startsWith('https://github.com/')) return
  if (!matchGitHubDiffUrl(a.href)) return
  const url = new URL(a.href)
  if (url.searchParams.has(SKIP_PARAM)) return
  url.searchParams.set(SKIP_PARAM, '1')
  a.href = url.toString()
}

function tagAll(): void {
  document
    .querySelectorAll<HTMLAnchorElement>('a[href^="https://github.com/"]')
    .forEach(tagLink)
}

tagAll()
new MutationObserver(tagAll).observe(document, { subtree: true, childList: true })
