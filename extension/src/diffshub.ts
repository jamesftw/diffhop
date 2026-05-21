/**
 * Content script for diffshub.com.
 *
 * Tags DiffsHub's "View on GitHub" links (rel="noreferrer", so otherwise
 * indistinguishable from a typed URL) with the SKIP_PARAM query. The network
 * -layer redirect rule exempts requests carrying it, and the GitHub content
 * script strips it — letting the user escape back to GitHub. DiffsHub renders
 * its links client-side, so we tag on load and again whenever the DOM changes.
 */
import { matchGitHubDiffUrl } from './urls';
import { SKIP_PARAM } from './escape';

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
