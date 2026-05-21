/**
 * Content script for diffshub.com (isolated world). Three jobs:
 *  1. Bridge the MAIN-world fetch patch (diffshub-main.ts) to the background:
 *     relay /api/diff requests so the background does the authenticated GitHub
 *     API call, and post the diff back. The token never enters the page.
 *  2. Tag DiffsHub's "View on GitHub" links with the SKIP_PARAM escape marker.
 *  3. Fast-forward Back past DiffsHub's duplicate history entries.
 */
import { matchGitHubDiffUrl } from './urls';
import { SKIP_PARAM } from './escape';

const TAG = 'diffhop';

// Bridge: MAIN world → background → MAIN world.
window.addEventListener('message', (e) => {
  if (e.source !== window || (e.data as { __tag?: string })?.__tag !== TAG) return;
  const data = e.data as { __tag: string; dir: string; id: number; url: string };
  if (data.dir !== 'request') return;
  chrome.runtime.sendMessage({ type: 'fetchDiff', url: data.url }, (resp) => {
    window.postMessage(
      { __tag: TAG, dir: 'response', id: data.id, ...(resp ?? { ok: false }) },
      '*',
    );
  });
});

function tagLink(a: HTMLAnchorElement): void {
  if (!a.href.startsWith('https://github.com/')) return;
  if (!matchGitHubDiffUrl(a.href)) return;
  const url = new URL(a.href);
  if (url.searchParams.has(SKIP_PARAM)) return;
  url.searchParams.set(SKIP_PARAM, '1');
  a.href = url.toString();
}

function tagAll(): void {
  document
    .querySelectorAll<HTMLAnchorElement>('a[href^="https://github.com/"]')
    .forEach(tagLink);
}

tagAll();
new MutationObserver(tagAll).observe(document, { subtree: true, childList: true });

/**
 * Escape DiffsHub's duplicate history entries: when a Back/Forward lands on an
 * entry with the same URL (the duplicate signature DiffsHub's router can leave),
 * keep going back so the user reaches a real previous page. Capped so it can
 * never loop forever.
 */
const MAX_DEDUPE_SKIPS = 25;
let historyUrl = location.href;
let dedupeSkips = 0;

window.addEventListener('popstate', () => {
  if (location.href === historyUrl) {
    if (dedupeSkips < MAX_DEDUPE_SKIPS) {
      dedupeSkips += 1;
      history.back();
    }
  } else {
    historyUrl = location.href;
    dedupeSkips = 0;
  }
});
