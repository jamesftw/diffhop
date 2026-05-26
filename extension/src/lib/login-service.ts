/**
 * Pure decision helpers for the Device Flow login, extracted from the
 * background script. The background still owns the `chrome.alarms` /
 * `chrome.storage` wiring; these functions hold the logic worth testing:
 * building the persisted device state, and deciding what to do with each poll.
 */
import type { DeviceCode, PollResult } from '../auth'
import type { DeviceState } from './storage'

/**
 * Build the {@link DeviceState} to persist from a fresh device-code response.
 * Prefers the provider's pre-filled verification URL when present (GitHub
 * doesn't send one), otherwise appends `user_code` so the popup can deep-link.
 */
export function buildDeviceState(device: DeviceCode, now: number): DeviceState {
  const verification_uri =
    device.verification_uri_complete ??
    `${device.verification_uri}?user_code=${encodeURIComponent(device.user_code)}`
  return {
    device_code: device.device_code,
    user_code: device.user_code,
    verification_uri,
    expires_at: now + device.expires_in * 1000,
  }
}

/** What the background should do after one poll of the token endpoint. */
export type PollOutcome =
  | { action: 'token'; token: string }
  | { action: 'stop' }
  | { action: 'wait' }

/**
 * Decide the next step given the stored device state, the current time, and a
 * poll result. Returns `stop` when the device code has expired or the poll
 * errored, `token` when granted, and `wait` for pending / slow_down.
 */
export function decidePollOutcome(
  device: DeviceState | null,
  now: number,
  result: PollResult,
): PollOutcome {
  if (!device || now > device.expires_at) return { action: 'stop' }
  if (result.status === 'ok') return { action: 'token', token: result.token }
  if (result.status === 'error') return { action: 'stop' }
  return { action: 'wait' }
}
