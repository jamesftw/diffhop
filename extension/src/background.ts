/**
 * Service worker: keeps the dNR redirect rules in sync with config, serves
 * DiffsHub's authenticated `/api/diff`, and drives the Device Flow sign-in on a
 * chrome.alarms cadence. Testable logic lives in `lib/`.
 */
import { buildDynamicRules, RULE_IDS } from './rules'
import { requestDeviceCode, pollOnce } from './auth'
import {
  GITHUB_CLIENT_ID,
  DIFF_STREAM_PORT,
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
import { streamDiff, type DiffSink } from './lib/diff-service'
import { buildDeviceState, decidePollOutcome } from './lib/login-service'
import {
  isRuntimeMessage,
  type DiffPortInbound,
  type DiffPortOutbound,
  type LoginResponse,
  type AckResponse,
} from './lib/messages'

/** Mirror the diff outcome on the toolbar badge + a flag the popup reads: a 404
 * means the App isn't installed on that repo; a success clears the nudge. */
function signalAccess(status?: number): void {
  if (status === 404) {
    void setNeedsAccess(true)
    void chrome.action.setBadgeText({ text: '!' })
    void chrome.action.setBadgeBackgroundColor({ color: '#bf8700' })
  } else if (status && status >= 200 && status < 300) {
    void setNeedsAccess(false)
    void chrome.action.setBadgeText({ text: '' })
  }
}

// --- Diff streaming --------------------------------------------------------

/** The diffshub.com bridge opens a port per diff; we stream the GitHub response
 * back over it (head → chunk* → end|error) and abort the fetch if it closes. */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== DIFF_STREAM_PORT) return
  const controller = new AbortController()
  let started = false

  const post = (msg: DiffPortOutbound): void => {
    try {
      port.postMessage(msg)
    } catch {
      /* port already disconnected; the abort below stops the fetch */
    }
  }
  const sink: DiffSink = {
    head: (ok, status) => {
      signalAccess(status)
      post({ type: 'head', ok, status })
    },
    chunk: (bytes) => post({ type: 'chunk', bytes }),
    end: () => post({ type: 'end' }),
    error: () => post({ type: 'error' }),
  }

  port.onMessage.addListener((msg: DiffPortInbound) => {
    if (msg.type === 'cancel') {
      controller.abort()
    } else if (msg.type === 'start' && !started) {
      started = true
      // `fetch` must keep its global `this`; bound here so streamDiff's
      // `deps.fetch(...)` call doesn't throw "Illegal invocation".
      streamDiff(
        msg.url,
        { isEnabled, getToken, fetch: fetch.bind(globalThis), signal: controller.signal },
        sink,
      ).catch(() => sink.error())
    }
  })
  port.onDisconnect.addListener(() => controller.abort())
})

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

/** Poll the token endpoint once and act on the result. Driven by the popup
 * (fast, while open) and the alarm backstop (when the popup is closed). */
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

async function startLogin(): Promise<{ user_code: string; verification_uri: string }> {
  const device = await requestDeviceCode(GITHUB_CLIENT_ID)
  const state = buildDeviceState(device, Date.now())
  await setDevice(state)
  // Backstop poll for when the popup is closed (the popup polls fast while open).
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

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) void pollTick()
})

// --- Message router --------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!isRuntimeMessage(msg)) return undefined

  if (msg.type === 'login') {
    startLogin()
      .then(
        (info): LoginResponse => ({ ok: true, ...info }),
        (err): LoginResponse => ({ ok: false, error: String(err?.message ?? err) }),
      )
      .then(sendResponse)
    return true
  }
  if (msg.type === 'pollNow') {
    pollTick().then(
      () => sendResponse({ ok: true } satisfies AckResponse),
      () => sendResponse({ ok: false } satisfies AckResponse),
    )
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
