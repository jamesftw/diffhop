/**
 * Popup controller. Enabled toggle (synced) + read-only GitHub sign-in via the
 * GitHub App Device Flow. Dependencies are injected so the logic runs under
 * jsdom in tests; the auto-init at the bottom wires the real chrome APIs.
 */
import { DEFAULT_CONFIG, APP_INSTALL_URL, POLL_INTERVAL_SECONDS } from './lib/config'
import {
  getConfig,
  setConfig,
  getToken,
  getDevice,
  getNeedsAccess,
  onTokenChanged,
} from './lib/storage'
import {
  type LoginMessage,
  type PollNowMessage,
  type SignoutMessage,
  type LoginResponse,
} from './lib/messages'

export const DEFAULTS = DEFAULT_CONFIG

export interface PendingLogin {
  user_code: string
  verification_uri: string
}

export interface PopupDeps {
  getConfig(): Promise<{ enabled?: boolean }>
  setConfig(cfg: { enabled: boolean }): Promise<void>
  getToken(): Promise<string>
  onTokenChange(cb: (token: string) => void): void
  /** A sign-in awaiting approval (so reopening the popup re-shows the code). */
  getPending(): Promise<PendingLogin | null>
  /** Whether a diff fetch 404'd (App not installed on a repo just viewed). */
  needsAccess(): Promise<boolean>
  login(): Promise<PendingLogin>
  /** Ask the background to poll the token endpoint once, right now. */
  pollNow(): Promise<void>
  signout(): Promise<void>
  openUrl(url: string): void
}

export interface PopupController {
  load(): Promise<void>
}

export function initPopup(doc: Document, deps: PopupDeps): PopupController {
  const enabledEl = doc.getElementById('enabled') as HTMLInputElement
  const authBtn = doc.getElementById('authBtn') as HTMLButtonElement
  const authStatus = doc.getElementById('authStatus') as HTMLElement
  const authMsg = doc.getElementById('authMsg') as HTMLElement
  const manageRepos = doc.getElementById('manageRepos') as HTMLElement

  // While a sign-in is pending and the popup is open, poll the token endpoint
  // fast (the worker can't be relied on to poll quickly on its own). Stops the
  // moment the token arrives.
  let pendingPoll: ReturnType<typeof setInterval> | undefined
  function startPendingPoll(): void {
    if (pendingPoll !== undefined) return
    void deps.pollNow()
    pendingPoll = setInterval(() => void deps.pollNow(), POLL_INTERVAL_SECONDS * 1000)
  }
  function stopPendingPoll(): void {
    if (pendingPoll !== undefined) {
      clearInterval(pendingPoll)
      pendingPoll = undefined
    }
  }

  function renderAuth(token: string): void {
    if (token) {
      stopPendingPoll()
      authStatus.textContent = 'Signed in'
      authBtn.textContent = 'Sign out'
      authBtn.dataset.mode = 'out'
      authMsg.textContent = ''
      manageRepos.hidden = false // signed in: offer to grant repos
    } else {
      authStatus.textContent = 'Not signed in'
      authBtn.textContent = 'Sign in with GitHub'
      authBtn.dataset.mode = 'in'
      manageRepos.hidden = true
    }
  }

  async function load(): Promise<void> {
    const cfg = { ...DEFAULTS, ...(await deps.getConfig()) }
    enabledEl.checked = cfg.enabled
    const token = await deps.getToken()
    renderAuth(token)
    if (token) {
      // A recent diff 404'd → the App can't see that repo; nudge to grant it.
      if (await deps.needsAccess()) {
        authMsg.textContent =
          "diffhop can't see a repo you opened. Choose the repos to grant:"
      }
    } else {
      const pending = await deps.getPending()
      if (pending) {
        authStatus.textContent = 'Waiting for authorization…'
        authMsg.textContent = `Enter code ${pending.user_code} at github.com/login/device`
        startPendingPoll()
      }
    }
  }

  enabledEl.addEventListener('change', () => {
    void deps.setConfig({ enabled: enabledEl.checked })
  })

  authBtn.addEventListener('click', async () => {
    if (authBtn.dataset.mode === 'out') {
      await deps.signout()
      renderAuth('')
      return
    }
    authBtn.disabled = true
    try {
      const { user_code, verification_uri } = await deps.login()
      authStatus.textContent = 'Waiting for authorization…'
      authMsg.textContent = `Approve code ${user_code}, then grant the repos you want.`
      startPendingPoll()
      deps.openUrl(verification_uri)
    } catch (err) {
      authMsg.textContent = `Sign-in failed: ${(err as Error).message}`
    } finally {
      authBtn.disabled = false
    }
  })

  manageRepos.addEventListener('click', () => deps.openUrl(APP_INSTALL_URL))

  deps.onTokenChange((token) => renderAuth(token))

  return { load }
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.storage) {
  const controller = initPopup(document, {
    getConfig,
    setConfig,
    getToken,
    onTokenChange: onTokenChanged,
    getPending: async () => {
      const d = await getDevice()
      return d && d.expires_at > Date.now()
        ? { user_code: d.user_code, verification_uri: d.verification_uri }
        : null
    },
    needsAccess: getNeedsAccess,
    login: () =>
      chrome.runtime
        .sendMessage({ type: 'login' } satisfies LoginMessage)
        .then((r: LoginResponse) => {
          if (!r.ok) throw new Error(r.error)
          return { user_code: r.user_code, verification_uri: r.verification_uri }
        }),
    pollNow: () =>
      chrome.runtime
        .sendMessage({ type: 'pollNow' } satisfies PollNowMessage)
        .then(() => undefined),
    signout: () =>
      chrome.runtime
        .sendMessage({ type: 'signout' } satisfies SignoutMessage)
        .then(() => undefined),
    openUrl: (url) => void chrome.tabs.create({ url }),
  })
  void controller.load()
}
