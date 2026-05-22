/**
 * github.com content script: redirects GitHub's in-page (SPA / Turbo)
 * navigations, which make no main-frame request and so escape the dNR rule.
 * Honors two escapes back to GitHub: the SKIP_PARAM marker (stripped here, then
 * sticky per tab) and Back/Forward onto a diff page.
 */
import { SKIP_PARAM, SKIP_FLAG } from './lib/config'
import { isEnabled } from './lib/storage'
import { decideRedirect } from './lib/redirect'
import { extensionAlive } from './lib/runtime'

let lastHref = location.href

/**
 * True when this tab should be left on GitHub. Arriving with the SKIP_PARAM
 * marker sets a sticky per-tab flag and strips the marker from the URL, so the
 * escape survives in-page navigation within the tab.
 */
function escapeActive(): boolean {
  const url = new URL(location.href)
  if (url.searchParams.has(SKIP_PARAM)) {
    try {
      sessionStorage.setItem(SKIP_FLAG, '1')
    } catch {
      /* sessionStorage may be unavailable; the marker alone still skips once */
    }
    url.searchParams.delete(SKIP_PARAM)
    try {
      history.replaceState(history.state, '', url.toString())
    } catch {
      /* ignore */
    }
    lastHref = location.href
    return true
  }
  try {
    return sessionStorage.getItem(SKIP_FLAG) === '1'
  } catch {
    return false
  }
}

/** True when this document load was a browser Back/Forward navigation. */
function loadedViaBackForward(): boolean {
  try {
    const [nav] = performance.getEntriesByType(
      'navigation',
    ) as PerformanceNavigationTiming[]
    return nav?.type === 'back_forward'
  } catch {
    return false
  }
}

async function redirectIfDiff(viaHistory: boolean): Promise<void> {
  // After an extension reload this stale script's chrome handle is dead; bail
  // quietly instead of throwing "Extension context invalidated".
  if (!extensionAlive()) return
  // escapeActive() has side effects (sets the sticky flag, strips the marker),
  // so call it before any early return. The bounce decision itself is pure.
  const escaped = escapeActive()
  let enabled: boolean
  try {
    enabled = await isEnabled()
  } catch {
    return // context invalidated between the check and the storage read
  }
  const target = decideRedirect({
    href: location.href,
    enabled,
    escapeActive: escaped,
    viaHistory,
  })
  if (target) location.replace(target)
}

function onPossibleNavigation(viaHistory: boolean): void {
  if (location.href === lastHref) return
  lastHref = location.href
  void redirectIfDiff(viaHistory)
}

for (const evt of ['turbo:load', 'turbo:render', 'pjax:end']) {
  window.addEventListener(evt, () => onPossibleNavigation(false), true)
}
window.addEventListener('popstate', () => onPossibleNavigation(true), true)

new MutationObserver(() => onPossibleNavigation(false)).observe(document, {
  subtree: true,
  childList: true,
})

void redirectIfDiff(loadedViaBackForward())
