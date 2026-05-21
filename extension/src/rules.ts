/**
 * Builds the dynamic declarativeNetRequest rules.
 *
 * 1. Main-frame redirect: GitHub diff pages → DiffsHub, at the network layer so
 *    there's no GitHub paint before the redirect. Transparent (no GitHub history
 *    entry), so Back returns to the previous page (e.g. the PR list).
 * 2. Allow exception: requests carrying the SKIP_PARAM marker (DiffsHub's tagged
 *    "View on GitHub" link) are exempted, so the user can reach GitHub.
 * 3. /api/diff → localhost proxy, only when a PAT is configured.
 */
import { SKIP_PARAM } from './escape';

export const RULE_MAIN_REDIRECT = 1;
export const RULE_MAIN_ALLOW = 2;
export const RULE_API_REDIRECT = 3;

export const RULE_IDS = [RULE_MAIN_REDIRECT, RULE_MAIN_ALLOW, RULE_API_REDIRECT];

export const DEFAULT_PORT = 7547;

// Matches the canonical diff path of a GitHub pull/commit/compare URL. Kept
// small to stay under Chrome's 2KB compiled-regex budget; the alternation stops
// at the path segment so PR sub-tabs, `.diff` suffixes, query, and hash are all
// dropped from the captured group.
// The trailing `.*$` makes the rule match the whole URL so the substitution
// replaces all of it — dropping `.diff`/`.patch`, PR sub-tabs (`/files`), query,
// and hash rather than carrying them onto DiffsHub.
const DIFF_PATH_REGEX =
  '^https://github\\.com(/[^/]+/[^/]+/(?:pull/\\d+|commit/\\w+|compare/[^/?#]+)).*$';

export interface ExtensionConfig {
  enabled: boolean;
  port: number;
  pat: string;
}

export function buildDynamicRules(
  config: ExtensionConfig,
): chrome.declarativeNetRequest.Rule[] {
  if (!config.enabled) return [];

  const rules: chrome.declarativeNetRequest.Rule[] = [
    // Higher priority: exempt the escape-marked requests from the redirect.
    {
      id: RULE_MAIN_ALLOW,
      priority: 2,
      action: { type: 'allow' },
      condition: {
        regexFilter: `^https://github\\.com/.*${SKIP_PARAM}`,
        resourceTypes: ['main_frame'],
      },
    },
    {
      id: RULE_MAIN_REDIRECT,
      priority: 1,
      action: {
        type: 'redirect',
        redirect: { regexSubstitution: 'https://diffshub.com\\1' },
      },
      condition: {
        regexFilter: DIFF_PATH_REGEX,
        resourceTypes: ['main_frame'],
      },
    },
  ];

  if (config.pat.trim() !== '') {
    const port =
      Number.isInteger(config.port) && config.port > 0 && config.port <= 65535
        ? config.port
        : DEFAULT_PORT;

    rules.push({
      id: RULE_API_REDIRECT,
      priority: 1,
      action: {
        type: 'redirect',
        redirect: {
          regexSubstitution: `http://localhost:${port}/api/diff?\\1`,
        },
      },
      condition: {
        regexFilter: '^https://diffshub\\.com/api/diff\\?(.*)$',
        initiatorDomains: ['diffshub.com'],
        resourceTypes: ['xmlhttprequest'],
      },
    });
  }

  return rules;
}
