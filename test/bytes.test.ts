import { describe, it, expect } from 'vitest'
import { bytesToBase64, base64ToBytes } from '../extension/src/lib/bytes'

describe('base64 byte transport', () => {
  const roundtrip = (bytes: Uint8Array) => base64ToBytes(bytesToBase64(bytes))

  it('round-trips arbitrary binary bytes (incl. 0x00 and 0xff)', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x7f, 0x80, 0xff, 0x00, 0x68, 0x69])
    expect(Array.from(roundtrip(bytes))).toEqual(Array.from(bytes))
  })

  it('round-trips an empty buffer', () => {
    expect(bytesToBase64(new Uint8Array())).toBe('')
    expect(base64ToBytes('').length).toBe(0)
  })

  it('round-trips multi-byte UTF-8 text without corruption', () => {
    const text = 'diff --git a/café.ts b/café.ts\n+const π = 3.14 // 🎉\n'
    const bytes = new TextEncoder().encode(text)
    expect(new TextDecoder().decode(roundtrip(bytes))).toBe(text)
  })

  it('round-trips a large buffer past the fromCharCode chunk window', () => {
    const bytes = new Uint8Array(100_000)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256
    const out = roundtrip(bytes)
    expect(out.length).toBe(bytes.length)
    expect(out[0]).toBe(0)
    expect(out[99_999]).toBe(99_999 % 256)
  })
})
