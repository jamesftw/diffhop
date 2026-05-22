/**
 * Popup controller. Enabled toggle (synced) + GitHub sign-in via Device Flow.
 * Dependencies are injected so the logic can run under jsdom in tests; the
 * auto-init at the bottom wires the real chrome APIs.
 */
export const CONFIG_KEY = 'diffshub-config';
export const TOKEN_KEY = 'diffshub-token';
export const DEVICE_KEY = 'diffshub-device';

export const DEFAULTS = { enabled: true };

export interface PendingLogin {
  user_code: string;
  verification_uri: string;
}

export interface PopupDeps {
  getConfig(): Promise<{ enabled?: boolean }>;
  setConfig(cfg: { enabled: boolean }): Promise<void>;
  getToken(): Promise<string>;
  onTokenChange(cb: (token: string) => void): void;
  /** A login awaiting authorization (so reopening the popup re-shows the code). */
  getPending(): Promise<PendingLogin | null>;
  login(): Promise<PendingLogin>;
  signout(): Promise<void>;
  openUrl(url: string): void;
}

export interface PopupController {
  load(): Promise<void>;
}

export function initPopup(doc: Document, deps: PopupDeps): PopupController {
  const enabledEl = doc.getElementById('enabled') as HTMLInputElement;
  const authBtn = doc.getElementById('authBtn') as HTMLButtonElement;
  const authStatus = doc.getElementById('authStatus') as HTMLElement;
  const deviceInfo = doc.getElementById('deviceInfo') as HTMLElement;

  function renderAuth(token: string): void {
    if (token) {
      authStatus.textContent = 'Signed in';
      authBtn.textContent = 'Sign out';
      authBtn.dataset.mode = 'out';
      deviceInfo.textContent = '';
    } else {
      authStatus.textContent = 'Not signed in';
      authBtn.textContent = 'Sign in with GitHub';
      authBtn.dataset.mode = 'in';
    }
  }

  async function load(): Promise<void> {
    const cfg = { ...DEFAULTS, ...(await deps.getConfig()) };
    enabledEl.checked = cfg.enabled;
    const token = await deps.getToken();
    renderAuth(token);
    if (!token) {
      const pending = await deps.getPending();
      if (pending) {
        authStatus.textContent = 'Waiting for authorization…';
        deviceInfo.textContent = `Code ${pending.user_code} — open github.com/login/device`;
      }
    }
  }

  enabledEl.addEventListener('change', () => {
    void deps.setConfig({ enabled: enabledEl.checked });
  });

  authBtn.addEventListener('click', async () => {
    if (authBtn.dataset.mode === 'out') {
      await deps.signout();
      renderAuth('');
      return;
    }
    authBtn.disabled = true;
    try {
      const { user_code, verification_uri } = await deps.login();
      deviceInfo.textContent = `Enter code ${user_code} on the page that opened`;
      authStatus.textContent = 'Waiting for authorization…';
      deps.openUrl(verification_uri);
    } catch (err) {
      deviceInfo.textContent = `Login failed: ${(err as Error).message}`;
    } finally {
      authBtn.disabled = false;
    }
  });

  deps.onTokenChange((token) => renderAuth(token));

  return { load };
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.storage) {
  const controller = initPopup(document, {
    getConfig: async () =>
      ((await chrome.storage.sync.get(CONFIG_KEY))[CONFIG_KEY] as { enabled?: boolean }) ?? {},
    setConfig: (cfg) => chrome.storage.sync.set({ [CONFIG_KEY]: cfg }),
    getToken: async () => ((await chrome.storage.local.get(TOKEN_KEY))[TOKEN_KEY] as string) ?? '',
    onTokenChange: (cb) =>
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[TOKEN_KEY]) cb((changes[TOKEN_KEY].newValue as string) ?? '');
      }),
    getPending: async () => {
      const d = (await chrome.storage.local.get(DEVICE_KEY))[DEVICE_KEY] as
        | (PendingLogin & { expires_at: number })
        | undefined;
      return d && d.expires_at > Date.now()
        ? { user_code: d.user_code, verification_uri: d.verification_uri }
        : null;
    },
    login: () =>
      chrome.runtime.sendMessage({ type: 'login' }).then((r) => {
        if (!r?.ok) throw new Error(r?.error ?? 'login failed');
        return r;
      }),
    signout: () => chrome.runtime.sendMessage({ type: 'signout' }).then(() => undefined),
    openUrl: (url) => void chrome.tabs.create({ url }),
  });
  void controller.load();
}
