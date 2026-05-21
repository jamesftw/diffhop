/**
 * Service worker: keeps the dynamic declarativeNetRequest rule (DiffsHub
 * /api/diff → localhost proxy) in sync with stored config.
 *
 * The github.com → DiffsHub redirect itself lives entirely in the content
 * script, which (unlike the service worker) can see the per-tab "escape" state
 * needed to let users navigate back to GitHub.
 */
import { buildDynamicRules, RULE_IDS, DEFAULT_PORT, type ExtensionConfig } from './rules';

const STORAGE_KEY = 'diffshub-config';

const DEFAULTS: ExtensionConfig = { enabled: true, port: DEFAULT_PORT, useProxy: false };

async function getConfig(): Promise<ExtensionConfig> {
  const data = await chrome.storage.sync.get(STORAGE_KEY);
  return { ...DEFAULTS, ...((data[STORAGE_KEY] as Partial<ExtensionConfig>) ?? {}) };
}

async function syncRules(): Promise<void> {
  const config = await getConfig();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: RULE_IDS,
    addRules: buildDynamicRules(config),
  });
}

chrome.runtime.onInstalled.addListener(syncRules);
chrome.runtime.onStartup.addListener(syncRules);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[STORAGE_KEY]) void syncRules();
});
