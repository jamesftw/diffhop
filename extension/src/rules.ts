/**
 * Builds the dynamic declarativeNetRequest rules: the main-frame redirect of
 * GitHub diff pages → DiffsHub (network-layer, so there's no GitHub paint and
 * Back stays transparent), plus an allow exception for the SKIP_PARAM escape
 * marker.
 *
 * DiffsHub's `/api/diff` fetch is handled separately, in the background script
 * (it does the authenticated GitHub API call) — not here.
 */
import { SKIP_PARAM } from './lib/config'
import type { ExtensionConfig } from './lib/storage'

export const RULE_MAIN_REDIRECT = 1
export const RULE_MAIN_ALLOW = 2

export const RULE_IDS = [RULE_MAIN_REDIRECT, RULE_MAIN_ALLOW]

const DIFF_PATH_REGEX =
  '^https://github\\.com(/[^/]+/[^/]+/(?:pull/\\d+|commit/\\w+|compare/[^/?#]+)).*$'

export function buildDynamicRules(
  config: ExtensionConfig,
): chrome.declarativeNetRequest.Rule[] {
  if (!config.enabled) return []

  return [
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
      condition: { regexFilter: DIFF_PATH_REGEX, resourceTypes: ['main_frame'] },
    },
  ]
}
