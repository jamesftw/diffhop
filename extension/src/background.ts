/**
 * Service worker: keeps the dNR redirect rules in sync with config, serves
 * DiffsHub's authenticated `/api/diff`, and drives the Device Flow sign-in on a
 * chrome.alarms cadence. Testable logic lives in `lib/`.
 */
import { buildDynamicRules, RULE_IDS } from './rules'
import { requestDeviceCode, pollOnce } from './auth'
import {
  GITHUB_CLIENT_ID,
  POLL_ALARM,
  POLL_INTERVAL_SECONDS,
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

/** Mirror the diff outcome on the toolbar badge + a flag the popup reads: a 404
 * means the App isn't installed on that repo; a success clears the nudge. */
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

let pollTimer: ReturnType<typeof setInterval> | undefined

/** Poll the token endpoint once and act on the result. Shared by the fast
 * in-worker timer and the alarm backstop. */
async function pollTick(): Promise<void> {
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
  // 'wait' (pending / slow_down): keep polling.
}

/** Poll every few seconds while authorization is pending. Each poll's fetch
 * also keeps the worker awake, so the token is picked up within seconds. */
function startFastPoll(): void {
  if (pollTimer !== undefined) return
  pollTimer = setInterval(() => void pollTick(), POLL_INTERVAL_SECONDS * 1000)
}

async function startLogin(): Promise<{ user_code: string; verification_uri: string }> {
  const device = await requestDeviceCode(GITHUB_CLIENT_ID)
  const state = buildDeviceState(device, Date.now())
  await setDevice(state)
  // Backstop in case the worker is terminated before the token arrives.
  await chrome.alarms.create(POLL_ALARM, {
    periodInMinutes: POLL_PERIOD_MINUTES,
    delayInMinutes: POLL_DELAY_MINUTES,
  })
  startFastPoll()
  return { user_code: state.user_code, verification_uri: state.verification_uri }
}

async function stopPolling(): Promise<void> {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer)
    pollTimer = undefined
  }
  await chrome.alarms.clear(POLL_ALARM)
  await clearDevice()
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== POLL_ALARM) return
  // If the worker was terminated mid-flow, restart the fast loop and poll now;
  // if it's already running, the alarm is a no-op.
  const wasRunning = pollTimer !== undefined
  startFastPoll()
  if (!wasRunning) void pollTick()
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
