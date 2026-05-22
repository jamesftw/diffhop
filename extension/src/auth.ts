/**
 * GitHub Device Flow for the diffhop GitHub App, run inside the service worker.
 * No client secret (Device Flow needs none) and no scope: a GitHub App's
 * permissions are defined on the app (read-only here), not requested per-login.
 * `fetch` is injectable for tests. Endpoints live in `lib/config`.
 */
import { ENDPOINTS } from './lib/config'

const DEVICE_CODE_URL = ENDPOINTS.deviceCode
const ACCESS_TOKEN_URL = ENDPOINTS.accessToken

export interface DeviceCode {
  device_code: string
  user_code: string
  verification_uri: string
  /** Some providers include a URL with the code pre-filled (GitHub doesn't). */
  verification_uri_complete?: string
  interval: number
  expires_in: number
}

export type PollResult =
  | { status: 'ok'; token: string }
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'error'; message: string }

export async function requestDeviceCode(
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeviceCode> {
  const res = await fetchImpl(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId }),
  })
  if (!res.ok) throw new Error(`device code request failed (HTTP ${res.status})`)
  return (await res.json()) as DeviceCode
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
  })
  const data = (await res.json()) as {
    access_token?: string
    error?: string
    error_description?: string
  }
  if (data.access_token) return { status: 'ok', token: data.access_token }
  if (data.error === 'authorization_pending') return { status: 'pending' }
  if (data.error === 'slow_down') return { status: 'slow_down' }
  return {
    status: 'error',
    message: data.error_description || data.error || 'authorization failed',
  }
}
