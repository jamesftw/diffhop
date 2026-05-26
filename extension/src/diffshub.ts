/**
 * Content script for diffshub.com (isolated world). Three jobs:
 *  1. Bridge the MAIN-world fetch patch (diffshub-main.ts) to the background:
 *     relay /api/diff requests so the background does the authenticated GitHub
 *     API call, and post the diff back. The token never enters the page.
 *  2. Tag DiffsHub's "View on GitHub" links with the SKIP_PARAM escape marker.
 *  3. Fast-forward Back past DiffsHub's duplicate history entries.
 */
import { matchGitHubDiffUrl } from './urls'
import { SKIP_PARAM, BRIDGE_TAG, DIFF_STREAM_PORT } from './lib/config'
import {
  isBridgeMessage,
  type BridgeMessage,
  type DiffPortOutbound,
} from './lib/messages'
import { extensionAlive } from './lib/runtime'

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
  let done = false

  port.onMessage.addListener((msg: DiffPortOutbound) => {
    if (msg.type === 'head') {
      toMain({ __tag: BRIDGE_TAG, dir: 'head', id, ok: msg.ok, status: msg.status })
      if (!msg.ok) ports.delete(id) // declined: background closes; nothing follows
    } else if (msg.type === 'chunk') {
      // Hand MAIN a transferable ArrayBuffer instead of cloning the bytes again.
      const u8 = msg.bytes
      const buf = (
        u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength
          ? u8.buffer
          : u8.slice().buffer
      ) as ArrayBuffer
      toMain({ __tag: BRIDGE_TAG, dir: 'chunk', id, bytes: buf }, [buf])
    } else if (msg.type === 'end') {
      done = true
      ports.delete(id)
      toMain({ __tag: BRIDGE_TAG, dir: 'end', id })
    } else if (msg.type === 'error') {
      done = true
      ports.delete(id)
      toMain({ __tag: BRIDGE_TAG, dir: 'error', id })
    }
  })

  port.onDisconnect.addListener(() => {
    ports.delete(id)
    if (!done) toMain({ __tag: BRIDGE_TAG, dir: 'error', id }) // SW died mid-stream
  })

  port.postMessage({ type: 'start', url })
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

/**
 * Escape DiffsHub's duplicate history entries: when a Back/Forward lands on an
 * entry with the same URL (the duplicate signature DiffsHub's router can leave),
 * keep going back so the user reaches a real previous page. Capped so it can
 * never loop forever.
 */
const MAX_DEDUPE_SKIPS = 25
let historyUrl = location.href
let dedupeSkips = 0

window.addEventListener('popstate', () => {
  if (location.href === historyUrl) {
    if (dedupeSkips < MAX_DEDUPE_SKIPS) {
      dedupeSkips += 1
      history.back()
    }
  } else {
    historyUrl = location.href
    dedupeSkips = 0
  }
})
