/**
 * Popup controller: loads/persists extension config to chrome.storage.sync.
 * Logic is exported and DOM/storage are injected so it can run under jsdom in
 * tests; the auto-init at the bottom only runs in the real extension popup.
 */
import { DEFAULT_PORT, type ExtensionConfig } from './rules';

export const STORAGE_KEY = 'diffshub-config';

export const DEFAULTS: ExtensionConfig = {
  enabled: true,
  port: DEFAULT_PORT,
  useProxy: false,
};

export function parsePort(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return DEFAULT_PORT;
  return n;
}

export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface PopupController {
  load(): Promise<void>;
  save(): Promise<void>;
}

export function initPopup(doc: Document, storage: StorageArea): PopupController {
  const enabledEl = doc.getElementById('enabled') as HTMLInputElement;
  const portEl = doc.getElementById('port') as HTMLInputElement;
  const useProxyEl = doc.getElementById('useProxy') as HTMLInputElement;
  const statusEl = doc.getElementById('status') as HTMLElement;
  const form = doc.getElementById('form') as HTMLFormElement;

  let saving = false;

  async function load(): Promise<void> {
    const data = await storage.get(STORAGE_KEY);
    const cfg = { ...DEFAULTS, ...((data[STORAGE_KEY] as Partial<ExtensionConfig>) ?? {}) };
    enabledEl.checked = cfg.enabled;
    portEl.value = String(cfg.port);
    useProxyEl.checked = cfg.useProxy;
  }

  async function save(): Promise<void> {
    if (saving) return; // guard against fast/double submits while a write is in flight
    saving = true;
    try {
      const cfg: ExtensionConfig = {
        enabled: enabledEl.checked,
        port: parsePort(portEl.value),
        useProxy: useProxyEl.checked,
      };
      portEl.value = String(cfg.port); // reflect the normalized port back to the field
      await storage.set({ [STORAGE_KEY]: cfg });
      statusEl.textContent = 'Saved';
    } finally {
      saving = false;
    }
  }

  enabledEl.addEventListener('change', save);
  portEl.addEventListener('change', save);
  useProxyEl.addEventListener('change', save);
  form.addEventListener('submit', (e) => {
    e.preventDefault(); // Enter key shouldn't reload the popup
    void save();
  });

  return { load, save };
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.storage) {
  const controller = initPopup(document, {
    get: (key) => chrome.storage.sync.get(key),
    set: (items) => chrome.storage.sync.set(items),
  });
  void controller.load();
}
