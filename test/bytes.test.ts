import { describe, it, expect } from 'vitest'
import { bytesToBase64, base64ToBytes } from '../extension/src/lib/bytes'

describe('base64 byte transport', () => {
  it('round-trips arbitrary bytes including the 0x80-0xFF range', () => {
    const original = new Uint8Array([0, 1, 2, 10, 65, 127, 128, 200, 254, 255])
    expect(base64ToBytes(bytesToBase64(original))).toEqual(original)
  })

  it('round-trips UTF-8 diff text with multi-byte characters', () => {
    const text = 'diff --git a/✓.ts b/✓.ts\n@@ -1 +1 @@\n-héllo\n+héllo 🎉\n'
    const original = new TextEncoder().encode(text)
    const decoded = new TextDecoder().decode(base64ToBytes(bytesToBase64(original)))
    expect(decoded).toBe(text)
  })

  it('handles empty input', () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array(0)))).toEqual(new Uint8Array(0))
  })

  it('handles large input beyond the fromCharCode chunk size', () => {
    const big = new Uint8Array(100_000).map((_, i) => i % 256)
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big)
  })
})
