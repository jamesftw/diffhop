/**
 * Typed message contracts shared by every script: runtime messages
 * (chrome.runtime.sendMessage → background) and bridge messages (postMessage
 * between the MAIN-world fetch patch and the isolated diffshub.com script).
 * Discriminated unions, so the compiler checks every sender and handler.
 */
import { BRIDGE_TAG } from './config'

// --- Runtime messages (→ background) ---------------------------------------

/** Ask the background to serve DiffsHub's `/api/diff` via the GitHub API. */
export interface FetchDiffMessage {
  type: 'fetchDiff'
  url: string
}
/** Start the GitHub Device Flow sign-in (request a device code, begin polling). */
export interface LoginMessage {
  type: 'login'
}
/** Clear the stored token and stop polling. */
export interface SignoutMessage {
  type: 'signout'
}

export type RuntimeMessage = FetchDiffMessage | LoginMessage | SignoutMessage

/** Response to {@link FetchDiffMessage}. `ok: false` means "page should fall
 * back to DiffsHub's own backend" (disabled, signed out, or unmappable URL). */
export interface DiffResponse {
  ok: boolean
  status?: number
  body?: string
}
/** Response to {@link LoginMessage}: the device code + where to enter it. */
export type LoginResponse =
  | { ok: true; user_code: string; verification_uri: string }
  | { ok: false; error: string }
/** Response carrying just a success flag (signout). */
export interface AckResponse {
  ok: boolean
  error?: string
}

// --- Bridge messages (MAIN world ↔ isolated content script) ----------------

/** MAIN world asks the isolated script to fetch a diff through the extension. */
export interface BridgeRequest {
  __tag: typeof BRIDGE_TAG
  dir: 'request'
  id: number
  url: string
}
/** Isolated script returns the diff (or a decline) to the MAIN world. */
export interface BridgeResponse extends DiffResponse {
  __tag: typeof BRIDGE_TAG
  dir: 'response'
  id: number
}

export type BridgeMessage = BridgeRequest | BridgeResponse

/** Narrow an arbitrary `postMessage` payload to one of ours. */
export function isBridgeMessage(data: unknown): data is BridgeMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { __tag?: unknown }).__tag === BRIDGE_TAG
  )
}

/** Narrow an arbitrary runtime message to one of ours. */
export function isRuntimeMessage(msg: unknown): msg is RuntimeMessage {
  if (typeof msg !== 'object' || msg === null) return false
  const type = (msg as { type?: unknown }).type
  return type === 'fetchDiff' || type === 'login' || type === 'signout'
}
