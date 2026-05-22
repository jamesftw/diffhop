import { describe, it, expect } from 'vitest'
import { buildDeviceState, decidePollOutcome } from '../extension/src/lib/login-service'
import type { DeviceCode } from '../extension/src/auth'
import type { DeviceState } from '../extension/src/lib/storage'

const baseDevice: DeviceCode = {
  device_code: 'dc',
  user_code: 'ABCD-1234',
  verification_uri: 'https://github.com/login/device',
  interval: 5,
  expires_in: 900,
}

describe('buildDeviceState', () => {
  it('appends the user_code to the verification URI when none is pre-filled', () => {
    const s = buildDeviceState(baseDevice, 1_000)
    expect(s.verification_uri).toBe('https://github.com/login/device?user_code=ABCD-1234')
    expect(s.expires_at).toBe(1_000 + 900 * 1000)
    expect(s.device_code).toBe('dc')
  })

  it('prefers a provider-supplied complete verification URI', () => {
    const s = buildDeviceState(
      { ...baseDevice, verification_uri_complete: 'https://example.com/done' },
      0,
    )
    expect(s.verification_uri).toBe('https://example.com/done')
  })
})

describe('decidePollOutcome', () => {
  const device: DeviceState = {
    device_code: 'dc',
    user_code: 'ABCD-1234',
    verification_uri: 'x',
    expires_at: 10_000,
  }

  it('stops when there is no device state', () => {
    expect(decidePollOutcome(null, 0, { status: 'pending' })).toEqual({ action: 'stop' })
  })

  it('stops when the device code has expired', () => {
    expect(decidePollOutcome(device, 10_001, { status: 'ok', token: 't' })).toEqual({
      action: 'stop',
    })
  })

  it('returns the token when granted', () => {
    expect(decidePollOutcome(device, 0, { status: 'ok', token: 'ghu_x' })).toEqual({
      action: 'token',
      token: 'ghu_x',
    })
  })

  it('stops on an error result', () => {
    expect(decidePollOutcome(device, 0, { status: 'error', message: 'denied' })).toEqual({
      action: 'stop',
    })
  })

  it('waits on pending / slow_down', () => {
    expect(decidePollOutcome(device, 0, { status: 'pending' })).toEqual({
      action: 'wait',
    })
    expect(decidePollOutcome(device, 0, { status: 'slow_down' })).toEqual({
      action: 'wait',
    })
  })
})
