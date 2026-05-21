/**
 * Service worker: keeps the dynamic declarativeNetRequest rules in sync with
 * stored state (enabled flag + GitHub token). The github.com → DiffsHub
 * redirect lives in the content script / dNR; here we only manage rules.
 * (Device-flow login handlers are appended below.)
 */
import { buildDynamicRules, RULE_IDS } from './rules';
import { toApiUrl } from './urls';
import { GITHUB_CLIENT_ID, OAUTH_SCOPE, requestDeviceCode, pollOnce } from './auth';

const CONFIG_KEY = 'diffshub-config';
const TOKEN_KEY = 'diffshub-token';
const DEVICE_KEY = 'diffshub-device';
const POLL_ALARM = 'diffshub-poll';

async function getEnabled(): Promise<boolean> {
  const data = await chrome.storage.sync.get(CONFIG_KEY);
  const cfg = data[CONFIG_KEY] as { enabled?: boolean } | undefined;
  return cfg?.enabled ?? true;
}

async function getToken(): Promise<string> {
  const data = await chrome.storage.local.get(TOKEN_KEY);
  return (data[TOKEN_KEY] as string) ?? '';
}

async function syncRules(): Promise<void> {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: RULE_IDS,
    addRules: buildDynamicRules({ enabled: await getEnabled() }),
  });
}

chrome.runtime.onInstalled.addListener(syncRules);
chrome.runtime.onStartup.addListener(syncRules);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[CONFIG_KEY]) void syncRules();
});

/**
 * Serve DiffsHub's /api/diff request: fetch the diff from the GitHub REST API
 * with the user's token. Returns { ok: false } when disabled or signed out so
 * the page falls back to DiffsHub's own backend (public repos still work).
 */
async function fetchDiff(
  diffshubUrl: string,
): Promise<{ ok: boolean; status?: number; body?: string }> {
  if (!(await getEnabled())) return { ok: false };
  const token = await getToken();
  if (token.trim() === '') return { ok: false };

  // DiffsHub calls fetch with a relative URL, so resolve against its origin.
  const pathParam = new URL(diffshubUrl, 'https://diffshub.com').searchParams.get('path'); // URL-decoded
  const apiUrl = pathParam && toApiUrl(pathParam);
  if (!apiUrl) return { ok: false };

  const res = await fetch(apiUrl, {
    headers: {
      Accept: 'application/vnd.github.diff',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
    },
  });
  return { ok: true, status: res.status, body: await res.text() };
}

// --- Device Flow login -----------------------------------------------------

interface DeviceState {
  device_code: string;
  expires_at: number;
}

async function startLogin(): Promise<{ user_code: string; verification_uri: string }> {
  const device = await requestDeviceCode(GITHUB_CLIENT_ID, OAUTH_SCOPE);
  await chrome.storage.local.set({
    [DEVICE_KEY]: { device_code: device.device_code, expires_at: Date.now() + device.expires_in * 1000 } satisfies DeviceState,
  });
  // Poll on an alarm so it survives the service worker being shut down.
  await chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5, delayInMinutes: 0.1 });
  return { user_code: device.user_code, verification_uri: device.verification_uri };
}

async function stopPolling(): Promise<void> {
  await chrome.alarms.clear(POLL_ALARM);
  await chrome.storage.local.remove(DEVICE_KEY);
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== POLL_ALARM) return;
  const data = await chrome.storage.local.get(DEVICE_KEY);
  const device = data[DEVICE_KEY] as DeviceState | undefined;
  if (!device || Date.now() > device.expires_at) {
    await stopPolling();
    return;
  }
  const result = await pollOnce(GITHUB_CLIENT_ID, device.device_code);
  if (result.status === 'ok') {
    await chrome.storage.local.set({ [TOKEN_KEY]: result.token }); // triggers syncRules
    await stopPolling();
  } else if (result.status === 'error') {
    await stopPolling();
  }
  // pending / slow_down: keep waiting for the next alarm.
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'fetchDiff') {
    fetchDiff(msg.url).then(sendResponse, () => sendResponse({ ok: false }));
    return true; // async response
  }
  if (msg?.type === 'login') {
    startLogin().then(
      (info) => sendResponse({ ok: true, ...info }),
      (err) => sendResponse({ ok: false, error: String(err?.message ?? err) }),
    );
    return true; // async response
  }
  if (msg?.type === 'signout') {
    Promise.all([chrome.storage.local.remove(TOKEN_KEY), stopPolling()]).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }
  return undefined;
});
