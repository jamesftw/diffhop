/**
 * Base64 transport for binary diff chunks. chrome.runtime Port messages are
 * serialized as JSON, so a Uint8Array does NOT survive the hop (it arrives as a
 * plain object and loses its methods). We ship each chunk as a base64 string,
 * which round-trips cleanly through both the port and window.postMessage, and
 * decode it back to bytes only in the page.
 */

/** Encode bytes to a base64 string (chunked so large inputs don't overflow the
 * argument limit of String.fromCharCode). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Decode a base64 string (from {@link bytesToBase64}) back to bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
