import { describe, it, expect, beforeEach } from 'vitest'
import {
  getConfig,
  setConfig,
  isEnabled,
  getToken,
  setToken,
  clearToken,
  getDevice,
  setDevice,
  clearDevice,
  getNeedsAccess,
  setNeedsAccess,
  type DeviceState,
} from '../extension/src/lib/storage'

/** Minimal in-memory stand-in for the two chrome.storage areas we use. */
function makeArea() {
  const store: Record<string, unknown> = {}
  return {
    store,
    get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
    set: async (obj: Record<string, unknown>) => void Object.assign(store, obj),
    remove: async (key: string) => void delete store[key],
  }
}

beforeEach(() => {
  const sync = makeArea()
  const local = makeArea()
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { sync, local, onChanged: { addListener: () => {} } },
  }
})

describe('config storage', () => {
  it('defaults enabled to true when nothing is stored', async () => {
    expect(await getConfig()).toEqual({ enabled: true })
    expect(await isEnabled()).toBe(true)
  })

  it('round-trips a stored config', async () => {
    await setConfig({ enabled: false })
    expect(await getConfig()).toEqual({ enabled: false })
    expect(await isEnabled()).toBe(false)
  })
})

describe('token storage', () => {
  it('returns an empty string when signed out', async () => {
    expect(await getToken()).toBe('')
  })

  it('round-trips and clears the token', async () => {
    await setToken('gho_x')
    expect(await getToken()).toBe('gho_x')
    await clearToken()
    expect(await getToken()).toBe('')
  })
})

describe('device storage', () => {
  const device: DeviceState = {
    device_code: 'dc',
    user_code: 'ABCD-1234',
    verification_uri: 'https://github.com/login/device',
    expires_at: 123,
  }

  it('returns null when no sign-in is in flight', async () => {
    expect(await getDevice()).toBeNull()
  })

  it('round-trips and clears device state', async () => {
    await setDevice(device)
    expect(await getDevice()).toEqual(device)
    await clearDevice()
    expect(await getDevice()).toBeNull()
  })
})

describe('needs-access flag', () => {
  it('defaults to false', async () => {
    expect(await getNeedsAccess()).toBe(false)
  })

  it('round-trips set and clear', async () => {
    await setNeedsAccess(true)
    expect(await getNeedsAccess()).toBe(true)
    await setNeedsAccess(false)
    expect(await getNeedsAccess()).toBe(false)
  })
})
