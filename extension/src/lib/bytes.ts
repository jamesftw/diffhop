/**
 * Base64 transport for diff chunks over the background↔isolated `chrome.runtime`
 * port. That port JSON-serializes its messages (it does *not* structured-clone),
 * so a raw `Uint8Array` arrives as a `{0:…,1:…}` plain object with no `.slice` —
 * corrupting the stream. We encode chunks to base64 (ASCII, JSON-safe) for that
 * hop and decode back to bytes in the isolated script, which then transfers a
 * real ArrayBuffer to MAIN (the window.postMessage hop *does* support transfer).
 * Pure and unit-tested; `btoa`/`atob` exist in both the worker and page contexts.
 */

// btoa takes a binary string, so build one with String.fromCharCode — applied in
// windows because spreading a whole large array would blow the argument-count cap.
const CHUNK = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
