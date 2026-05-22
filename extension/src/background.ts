/**
 * Service worker: the extension's privileged hub. It keeps the dynamic
 * declarativeNetRequest rules in sync with stored config, serves DiffsHub's
 * authenticated `/api/diff` requests, and drives the GitHub App Device Flow
 * sign-in on a `chrome.alarms` cadence (so it survives the worker shutting down).
 *
 * The logic worth testing lives in `lib/` (diff-service, login-service); this
 * file is the chrome-API wiring that calls into it.
 */
import { buildDynamicRules, RULE_IDS } from './rules'
import { requestDeviceCode, pollOnce } from './auth'
import {
  GITHUB_CLIENT_ID,
  POLL_ALARM,
  POLL_PERIOD_MINUTES,
  POLL_DELAY_MINUTES,
} from './lib/config'
import {
  isEnabled,
  getToken,
  setToken,
  clearToken,
  getDevice,
  setDevice,
  clearDevice,
  setNeedsAccess,
  onConfigChanged,
} from './lib/storage'
import { fetchDiff } from './lib/diff-service'
import { buildDeviceState, decidePollOutcome } from './lib/login-service'
import {
  isRuntimeMessage,
  type DiffResponse,
  type LoginResponse,
  type AckResponse,
} from './lib/messages'

/**
 * Reflect the diff outcome on the toolbar icon + a stored flag the popup reads.
 * A 404 with a valid token means the App isn't installed on that repo, so we
 * nudge the user to grant repositories; a success clears the nudge.
 */
function signalAccess(result: DiffResponse): void {
  if (result.status === 404) {
    void setNeedsAccess(true)
    void chrome.action.setBadgeText({ text: '!' })
    void chrome.action.setBadgeBackgroundColor({ color: '#bf8700' })
  } else if (result.status && result.status >= 200 && result.status < 300) {
    void setNeedsAccess(false)
    void chrome.action.setBadgeText({ text: '' })
  }
}

async function syncRules(): Promise<void> {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: RULE_IDS,
    addRules: buildDynamicRules({ enabled: await isEnabled() }),
  })
}

chrome.runtime.onInstalled.addListener(syncRules)
chrome.runtime.onStartup.addListener(syncRules)
onConfigChanged(() => void syncRules())

// --- Device Flow sign-in ---------------------------------------------------

async function startLogin(): Promise<{ user_code: string; verification_uri: string }> {
  const device = await requestDeviceCode(GITHUB_CLIENT_ID)
  const state = buildDeviceState(device, Date.now())
  await setDevice(state)
  // Poll on an alarm so it survives the service worker being shut down.
  await chrome.alarms.create(POLL_ALARM, {
    periodInMinutes: POLL_PERIOD_MINUTES,
    delayInMinutes: POLL_DELAY_MINUTES,
  })
  return { user_code: state.user_code, verification_uri: state.verification_uri }
}

async function stopPolling(): Promise<void> {
  await chrome.alarms.clear(POLL_ALARM)
  await clearDevice()
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== POLL_ALARM) return
  const device = await getDevice()
  if (!device) return void stopPolling()
  const result = await pollOnce(GITHUB_CLIENT_ID, device.device_code)
  const outcome = decidePollOutcome(device, Date.now(), result)
  if (outcome.action === 'token') {
    await setToken(outcome.token)
    await stopPolling()
  } else if (outcome.action === 'stop') {
    await stopPolling()
  }
  // 'wait' (pending / slow_down): keep waiting for the next alarm.
})

// --- Message router --------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!isRuntimeMessage(msg)) return undefined

  if (msg.type === 'fetchDiff') {
    // `fetch` must keep its global `this`; passed bare and called as
    // `deps.fetch(...)` it throws "Illegal invocation", so bind it here.
    fetchDiff(msg.url, { isEnabled, getToken, fetch: fetch.bind(globalThis) }).then(
      (result) => {
        signalAccess(result)
        sendResponse(result)
      },
      () => sendResponse({ ok: false }),
    )
    return true // async response
  }
  if (msg.type === 'login') {
    startLogin()
      .then(
        (info): LoginResponse => ({ ok: true, ...info }),
        (err): LoginResponse => ({ ok: false, error: String(err?.message ?? err) }),
      )
      .then(sendResponse)
    return true
  }
  if (msg.type === 'signout') {
    void chrome.action.setBadgeText({ text: '' })
    Promise.all([clearToken(), stopPolling(), setNeedsAccess(false)]).then(
      () => sendResponse({ ok: true } satisfies AckResponse),
      () => sendResponse({ ok: false } satisfies AckResponse),
    )
    return true
  }
  return undefined
})
