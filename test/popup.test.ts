// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initPopup, type PopupDeps } from '../extension/src/popup'
import { APP_INSTALL_URL } from '../extension/src/lib/config'

const FORM_HTML = `
  <form id="form">
    <input type="checkbox" id="enabled" />
    <span id="authStatus"></span>
    <button type="button" id="authBtn"></button>
    <p id="authMsg"></p>
    <button type="button" id="manageRepos" hidden></button>
  </form>
`

function makeDeps(
  opts: { config?: { enabled?: boolean }; token?: string; needsAccess?: boolean } = {},
) {
  let tokenListener: (t: string) => void = () => {}
  const deps: PopupDeps = {
    getConfig: vi.fn(async () => opts.config ?? { enabled: true }),
    setConfig: vi.fn(async () => {}),
    getToken: vi.fn(async () => opts.token ?? ''),
    onTokenChange: vi.fn((cb) => {
      tokenListener = cb
    }),
    getPending: vi.fn(async () => null),
    needsAccess: vi.fn(async () => opts.needsAccess ?? false),
    login: vi.fn(async () => ({
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
    })),
    signout: vi.fn(async () => {}),
    openUrl: vi.fn(),
  }
  return { deps, fireTokenChange: (t: string) => tokenListener(t) }
}

const el = (id: string) =>
  document.getElementById(id) as HTMLInputElement & HTMLButtonElement
const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  document.body.innerHTML = FORM_HTML
})

describe('initPopup', () => {
  it('loads the enabled state and signed-out auth state', async () => {
    const { deps } = makeDeps({ config: { enabled: false }, token: '' })
    await initPopup(document, deps).load()
    expect(el('enabled').checked).toBe(false)
    expect(el('authStatus').textContent).toBe('Not signed in')
    expect(el('authBtn').textContent).toBe('Sign in with GitHub')
  })

  it('shows signed-in state and reveals the repos link when a token is present', async () => {
    const { deps } = makeDeps({ token: 'ghu_x' })
    await initPopup(document, deps).load()
    expect(el('authStatus').textContent).toBe('Signed in')
    expect(el('authBtn').textContent).toBe('Sign out')
    expect(el('manageRepos').hidden).toBe(false)
  })

  it('keeps the repos link hidden when signed out', async () => {
    const { deps } = makeDeps({ token: '' })
    await initPopup(document, deps).load()
    expect(el('manageRepos').hidden).toBe(true)
  })

  it('opens the install page from the repos link', async () => {
    const { deps } = makeDeps({ token: 'ghu_x' })
    await initPopup(document, deps).load()
    el('manageRepos').dispatchEvent(new Event('click'))
    expect(deps.openUrl).toHaveBeenCalledWith(APP_INSTALL_URL)
  })

  it('nudges to grant repos when a diff recently 404d', async () => {
    const { deps } = makeDeps({ token: 'ghu_x', needsAccess: true })
    await initPopup(document, deps).load()
    expect(el('authMsg').textContent).toContain("can't see")
    expect(el('manageRepos').hidden).toBe(false)
  })

  it('re-shows the waiting state and code when a sign-in is pending', async () => {
    const { deps } = makeDeps({ token: '' })
    deps.getPending = vi.fn(async () => ({
      user_code: 'WXYZ-0000',
      verification_uri: 'https://github.com/login/device',
    }))
    await initPopup(document, deps).load()
    expect(el('authStatus').textContent).toBe('Waiting for authorization…')
    expect(el('authMsg').textContent).toContain('WXYZ-0000')
  })

  it('persists the enabled toggle', async () => {
    const { deps } = makeDeps()
    await initPopup(document, deps).load()
    el('enabled').checked = false
    el('enabled').dispatchEvent(new Event('change'))
    expect(deps.setConfig).toHaveBeenCalledWith({ enabled: false })
  })

  it('starts login, opens the verification page, and shows the code', async () => {
    const { deps } = makeDeps({ token: '' })
    await initPopup(document, deps).load()
    el('authBtn').dispatchEvent(new Event('click'))
    await tick()
    expect(deps.login).toHaveBeenCalled()
    expect(deps.openUrl).toHaveBeenCalledWith('https://github.com/login/device')
    expect(el('authMsg').textContent).toContain('ABCD-1234')
  })

  it('signs out when already signed in', async () => {
    const { deps } = makeDeps({ token: 'ghu_x' })
    await initPopup(document, deps).load()
    el('authBtn').dispatchEvent(new Event('click'))
    await tick()
    expect(deps.signout).toHaveBeenCalled()
    expect(el('authStatus').textContent).toBe('Not signed in')
  })

  it('reflects a token arriving while the popup is open', async () => {
    const { deps, fireTokenChange } = makeDeps({ token: '' })
    await initPopup(document, deps).load()
    expect(el('authStatus').textContent).toBe('Not signed in')
    fireTokenChange('ghu_new')
    expect(el('authStatus').textContent).toBe('Signed in')
  })
})
