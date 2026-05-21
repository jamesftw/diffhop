/**
 * Content script for github.com — fallback redirector for GitHub's in-page
 * (SPA / Turbo) navigations, which make no main-frame request and so aren't
 * caught by the declarativeNetRequest rule that handles full page loads.
 *
 * Escapes that keep the user from being trapped:
 *   - the SKIP_PARAM marker on DiffsHub's "View on GitHub" link (the dNR rule
 *     exempts it; here we strip it and set a sticky per-tab flag)
 *   - Back/Forward navigation onto a GitHub diff page (honored, not bounced)
 */
import { matchGitHubDiffUrl } from './urls';
import { SKIP_PARAM, SKIP_FLAG } from './escape';

const STORAGE_KEY = 'diffshub-config';
let lastHref = location.href;

async function isEnabled(): Promise<boolean> {
  const data = await chrome.storage.sync.get(STORAGE_KEY);
  const cfg = data[STORAGE_KEY] as { enabled?: boolean } | undefined;
  return cfg?.enabled ?? true;
}

/**
 * True when this tab should be left on GitHub. Arriving with the SKIP_PARAM
 * marker sets a sticky per-tab flag and strips the marker from the URL, so the
 * escape survives in-page navigation within the tab.
 */
function escapeActive(): boolean {
  const url = new URL(location.href);
  if (url.searchParams.has(SKIP_PARAM)) {
    try {
      sessionStorage.setItem(SKIP_FLAG, '1');
    } catch {
      /* sessionStorage may be unavailable; the marker alone still skips once */
    }
    url.searchParams.delete(SKIP_PARAM);
    try {
      history.replaceState(history.state, '', url.toString());
    } catch {
      /* ignore */
    }
    lastHref = location.href;
    return true;
  }
  try {
    return sessionStorage.getItem(SKIP_FLAG) === '1';
  } catch {
    return false;
  }
}

/** True when this document load was a browser Back/Forward navigation. */
function loadedViaBackForward(): boolean {
  try {
    const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    return nav?.type === 'back_forward';
  } catch {
    return false;
  }
}

async function redirectIfDiff(viaHistory: boolean): Promise<void> {
  if (escapeActive()) return;
  const match = matchGitHubDiffUrl(location.href);
  if (!match) return;
  // Arrived via Back/Forward → the user is walking their history and wants this
  // GitHub page; don't bounce them.
  if (viaHistory) return;
  if (!(await isEnabled())) return;
  location.replace(`https://diffshub.com${match.path}`);
}

function onPossibleNavigation(viaHistory: boolean): void {
  if (location.href === lastHref) return;
  lastHref = location.href;
  void redirectIfDiff(viaHistory);
}

for (const evt of ['turbo:load', 'turbo:render', 'pjax:end']) {
  window.addEventListener(evt, () => onPossibleNavigation(false), true);
}
window.addEventListener('popstate', () => onPossibleNavigation(true), true);

new MutationObserver(() => onPossibleNavigation(false)).observe(document, {
  subtree: true,
  childList: true,
});

void redirectIfDiff(loadedViaBackForward());
