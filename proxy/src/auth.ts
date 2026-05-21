/**
 * GitHub OAuth Device Flow — lets the user authenticate by approving a code at
 * github.com/login/device, with no client secret and no manual token creation.
 * fetch/sleep are injectable for testing.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { TOKEN_DIR, TOKEN_FILE } from './config';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

/**
 * Polls GitHub until the user authorizes. Resolves with the access token, or
 * throws on denial/expiry. Honors `authorization_pending` and `slow_down`.
 */
export async function pollForToken(
  clientId: string,
  deviceCode: string,
  intervalSec: number,
  fetchImpl: typeof fetch = fetch,
  sleepImpl: (ms: number) => Promise<void> = sleep,
): Promise<string> {
  let interval = intervalSec;
  for (;;) {
    await sleepImpl(interval * 1000);
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
    if (data.access_token) return data.access_token;
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') {
      interval += 5;
      continue;
    }
    throw new Error(data.error_description || data.error || 'authorization failed');
  }
}

export function saveToken(token: string): void {
  mkdirSync(TOKEN_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify({ access_token: token }), { mode: 0o600 });
}

export function loadToken(): string | null {
  try {
    const { access_token } = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
    return typeof access_token === 'string' && access_token ? access_token : null;
  } catch {
    return null;
  }
}
