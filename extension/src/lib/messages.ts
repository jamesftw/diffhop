/**
 * Typed message contracts shared by every script: runtime messages
 * (chrome.runtime.sendMessage → background) and bridge messages (postMessage
 * between the MAIN-world fetch patch and the isolated diffshub.com script).
 * Discriminated unions, so the compiler checks every sender and handler.
 */
import { BRIDGE_TAG } from './config'

// --- Runtime messages (→ background) ---------------------------------------

/** Start the GitHub Device Flow sign-in (request a device code, begin polling). */
export interface LoginMessage {
  type: 'login'
}
/** Poll the token endpoint once now (the popup drives this while it's open). */
export interface PollNowMessage {
  type: 'pollNow'
}
/** Clear the stored token and stop polling. */
export interface SignoutMessage {
  type: 'signout'
}

export type RuntimeMessage = LoginMessage | PollNowMessage | SignoutMessage

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
//
// The diff is streamed, so a single request is answered by a sequence: one
// `head` (or a `head` with ok:false meaning "fall back to DiffsHub"), then zero
// or more `chunk`s, then exactly one `end` or `error`. MAIN→isolated also sends
// a `cancel` when the page aborts the response (e.g. navigating to another diff).

/** MAIN world asks the isolated script to stream a diff through the extension. */
export interface BridgeRequest {
  __tag: typeof BRIDGE_TAG
  dir: 'request'
  id: number
  url: string
}
/** MAIN world aborts an in-flight stream (the page cancelled the Response body). */
export interface BridgeCancel {
  __tag: typeof BRIDGE_TAG
  dir: 'cancel'
  id: number
}
/** First reply: ok:false → MAIN falls back to DiffsHub's own fetch; otherwise
 * the HTTP status, followed by chunk/end messages. */
export interface BridgeHead {
  __tag: typeof BRIDGE_TAG
  dir: 'head'
  id: number
  ok: boolean
  status?: number
}
/** One slice of the diff body (transferred as an ArrayBuffer to avoid a copy). */
export interface BridgeChunk {
  __tag: typeof BRIDGE_TAG
  dir: 'chunk'
  id: number
  bytes: ArrayBuffer
}
/** Body finished cleanly. */
export interface BridgeEnd {
  __tag: typeof BRIDGE_TAG
  dir: 'end'
  id: number
}
/** Body failed mid-stream. */
export interface BridgeError {
  __tag: typeof BRIDGE_TAG
  dir: 'error'
  id: number
}

export type BridgeMessage =
  | BridgeRequest
  | BridgeCancel
  | BridgeHead
  | BridgeChunk
  | BridgeEnd
  | BridgeError

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
  return type === 'login' || type === 'pollNow' || type === 'signout'
}

// --- Diff-stream port messages (isolated content script ↔ background) -------
//
// Sent over a dedicated chrome.runtime.Port (name = DIFF_STREAM_PORT), so they
// need no tag. The isolated script opens the port and sends `start`; the
// background replies with head → chunk* → end|error. `cancel` (or closing the
// port) aborts the upstream GitHub fetch.

/** isolated → background: begin streaming the diff for this DiffsHub URL. */
export interface PortStart {
  type: 'start'
  url: string
}
/** isolated → background: abort the in-flight fetch. */
export interface PortCancel {
  type: 'cancel'
}
export type DiffPortInbound = PortStart | PortCancel

/** background → isolated: the streaming reply, mirroring the bridge head/chunk
 * /end/error (chunk bytes are a Uint8Array; ports structured-clone, no transfer). */
export type DiffPortOutbound =
  | { type: 'head'; ok: boolean; status?: number }
  | { type: 'chunk'; bytes: Uint8Array }
  | { type: 'end' }
  | { type: 'error' }
