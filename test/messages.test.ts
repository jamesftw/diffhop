import { describe, it, expect } from 'vitest'
import { isBridgeMessage, isRuntimeMessage } from '../extension/src/lib/messages'
import { BRIDGE_TAG } from '../extension/src/lib/config'

describe('isBridgeMessage', () => {
  it('accepts payloads stamped with the bridge tag', () => {
    expect(isBridgeMessage({ __tag: BRIDGE_TAG, dir: 'request', id: 1, url: 'x' })).toBe(
      true,
    )
  })

  it('rejects untagged, foreign, or non-object payloads', () => {
    expect(isBridgeMessage({ __tag: 'other', dir: 'request' })).toBe(false)
    expect(isBridgeMessage({ dir: 'request' })).toBe(false)
    expect(isBridgeMessage(null)).toBe(false)
    expect(isBridgeMessage('string')).toBe(false)
  })
})

describe('isRuntimeMessage', () => {
  it('accepts the known message types', () => {
    expect(isRuntimeMessage({ type: 'fetchDiff', url: 'x' })).toBe(true)
    expect(isRuntimeMessage({ type: 'login' })).toBe(true)
    expect(isRuntimeMessage({ type: 'signout' })).toBe(true)
  })

  it('rejects unknown types and non-objects', () => {
    expect(isRuntimeMessage({ type: 'nope' })).toBe(false)
    expect(isRuntimeMessage({})).toBe(false)
    expect(isRuntimeMessage(undefined)).toBe(false)
  })
})
