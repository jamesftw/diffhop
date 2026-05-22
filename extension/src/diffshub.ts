/**
 * Content script for diffshub.com (isolated world). Three jobs:
 *  1. Bridge the MAIN-world fetch patch (diffshub-main.ts) to the background:
 *     relay /api/diff requests so the background does the authenticated GitHub
 *     API call, and post the diff back. The token never enters the page.
 *  2. Tag DiffsHub's "View on GitHub" links with the SKIP_PARAM escape marker.
 *  3. Fast-forward Back past DiffsHub's duplicate history entries.
 */
import { matchGitHubDiffUrl } from './urls'
import { SKIP_PARAM, BRIDGE_TAG } from './lib/config'
import {
  isBridgeMessage,
  type FetchDiffMessage,
  type DiffResponse,
  type BridgeResponse,
} from './lib/messages'
import { extensionAlive } from './lib/runtime'

// Bridge: MAIN world → background → MAIN world.
window.addEventListener('message', (e) => {
  if (e.source !== window || !isBridgeMessage(e.data) || e.data.dir !== 'request') return
  // After an extension reload this stale relay's chrome handle is dead; bail
  // quietly (the user refreshes the tab) instead of throwing.
  if (!extensionAlive()) return
  const { id, url } = e.data
  const message: FetchDiffMessage = { type: 'fetchDiff', url }
  try {
    chrome.runtime.sendMessage(message, (resp: DiffResponse | undefined) => {
      const response: BridgeResponse = {
        __tag: BRIDGE_TAG,
        dir: 'response',
        id,
        ...(resp ?? { ok: false }),
      }
      window.postMessage(response, '*')
    })
  } catch {
    /* context invalidated between the check and the call */
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
