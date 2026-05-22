/**
 * GitHub OAuth Device Flow, run inside the extension's service worker. No
 * client secret (Device Flow needs none), no localhost proxy. fetch is
 * injectable for tests.
 *
 * The Client ID is public — it ships with the extension, like the `gh` CLI
 * bundles its own.
 */
export const GITHUB_CLIENT_ID = 'Ov23liODx8sAMhf2l7Ma';
export const OAUTH_SCOPE = 'repo';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  /** Some providers include a URL with the code pre-filled (GitHub doesn't). */
  verification_uri_complete?: string;
  interval: number;
  expires_in: number;
}

export type PollResult =
  | { status: 'ok'; token: string }
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'error'; message: string };

export async function requestDeviceCode(
  clientId: string,
  scope: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeviceCode> {
  const res = await fetchImpl(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope }),
  });
  if (!res.ok) throw new Error(`device code request failed (HTTP ${res.status})`);
  return (await res.json()) as DeviceCode;
}

/** One poll of the token endpoint (the SW polls on a chrome.alarms cadence). */
export async function pollOnce(
  clientId: string,
  deviceCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PollResult> {
  const res = await fetchImpl(ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (data.access_token) return { status: 'ok', token: data.access_token };
  if (data.error === 'authorization_pending') return { status: 'pending' };
  if (data.error === 'slow_down') return { status: 'slow_down' };
  return { status: 'error', message: data.error_description || data.error || 'authorization failed' };
}
