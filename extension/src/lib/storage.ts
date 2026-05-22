/**
 * Typed facade over `chrome.storage`: one place for the schema and the `enabled`
 * default. Sync = user config (roams across browsers); local = token + transient
 * Device Flow state (never roams).
 */
import { STORAGE_KEYS, DEFAULT_CONFIG } from './config'

/** Persisted extension config. */
export interface ExtensionConfig {
  enabled: boolean
}

/** Transient Device Flow state, stored while a sign-in is awaiting approval. */
export interface DeviceState {
  device_code: string
  user_code: string
  verification_uri: string
  /** Epoch ms after which the device code is no longer valid. */
  expires_at: number
}

/** Read config, applying defaults for any unset field. */
export async function getConfig(): Promise<ExtensionConfig> {
  const data = await chrome.storage.sync.get(STORAGE_KEYS.config)
  const stored = data[STORAGE_KEYS.config] as Partial<ExtensionConfig> | undefined
  return { ...DEFAULT_CONFIG, ...stored }
}

/** Convenience: just the enabled flag. */
export async function isEnabled(): Promise<boolean> {
  return (await getConfig()).enabled
}

export async function setConfig(config: ExtensionConfig): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEYS.config]: config })
}

/** Read the GitHub token, or `''` when signed out. */
export async function getToken(): Promise<string> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.token)
  return (data[STORAGE_KEYS.token] as string | undefined) ?? ''
}

export async function setToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.token]: token })
}

export async function clearToken(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.token)
}

export async function getDevice(): Promise<DeviceState | null> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.device)
  return (data[STORAGE_KEYS.device] as DeviceState | undefined) ?? null
}

export async function setDevice(state: DeviceState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.device]: state })
}

export async function clearDevice(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.device)
}

/** Set when a diff fetch 404s (the App lacks access to that repo), so the popup
 * nudges the user to grant repositories. */
export async function getNeedsAccess(): Promise<boolean> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.needsAccess)
  return data[STORAGE_KEYS.needsAccess] === true
}

export async function setNeedsAccess(needsAccess: boolean): Promise<void> {
  if (needsAccess) await chrome.storage.local.set({ [STORAGE_KEYS.needsAccess]: true })
  else await chrome.storage.local.remove(STORAGE_KEYS.needsAccess)
}

/** Subscribe to config changes (sync area). */
export function onConfigChanged(cb: () => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[STORAGE_KEYS.config]) cb()
  })
}

/** Subscribe to token changes (local area), receiving the new token (or ''). */
export function onTokenChanged(cb: (token: string) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEYS.token]) {
      cb((changes[STORAGE_KEYS.token].newValue as string | undefined) ?? '')
    }
  })
}
