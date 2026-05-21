// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initPopup, parsePort, STORAGE_KEY, DEFAULTS } from '../extension/src/popup';

const FORM_HTML = `
  <form id="form">
    <input type="checkbox" id="enabled" />
    <input type="number" id="port" />
    <input type="checkbox" id="useProxy" />
    <p id="status"></p>
  </form>
`;

function fakeStorage(initial: Record<string, unknown> = {}) {
  const store = { ...initial };
  return {
    store,
    get: vi.fn(async (key: string) => ({ [key]: store[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(store, items);
    }),
  };
}

beforeEach(() => {
  document.body.innerHTML = FORM_HTML;
});

describe('parsePort', () => {
  it.each([
    ['8080', 8080],
    ['7547', 7547],
    ['', DEFAULTS.port],
    ['abc', DEFAULTS.port],
    ['0', DEFAULTS.port],
    ['99999', DEFAULTS.port],
    ['-5', DEFAULTS.port],
  ])('parsePort(%j) -> %i', (raw, expected) => {
    expect(parsePort(raw as string)).toBe(expected);
  });
});

describe('initPopup', () => {
  it('loads stored config into the form fields', async () => {
    const storage = fakeStorage({ [STORAGE_KEY]: { enabled: false, port: 9000, useProxy: true } });
    const ctrl = initPopup(document, storage);
    await ctrl.load();

    expect((document.getElementById('enabled') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('port') as HTMLInputElement).value).toBe('9000');
    expect((document.getElementById('useProxy') as HTMLInputElement).checked).toBe(true);
  });

  it('falls back to defaults when nothing is stored', async () => {
    const storage = fakeStorage();
    const ctrl = initPopup(document, storage);
    await ctrl.load();
    expect((document.getElementById('port') as HTMLInputElement).value).toBe(String(DEFAULTS.port));
    expect((document.getElementById('enabled') as HTMLInputElement).checked).toBe(DEFAULTS.enabled);
  });

  it('persists normalized config on change', async () => {
    const storage = fakeStorage();
    initPopup(document, storage);

    (document.getElementById('enabled') as HTMLInputElement).checked = true;
    const port = document.getElementById('port') as HTMLInputElement;
    port.value = '8080';
    (document.getElementById('useProxy') as HTMLInputElement).checked = true;
    port.dispatchEvent(new Event('change'));
    await Promise.resolve();

    expect(storage.set).toHaveBeenCalledWith({
      [STORAGE_KEY]: { enabled: true, port: 8080, useProxy: true },
    });
  });

  it('reflects an invalid port back as the default', async () => {
    const storage = fakeStorage();
    initPopup(document, storage);
    const port = document.getElementById('port') as HTMLInputElement;
    port.value = 'not-a-port';
    port.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(port.value).toBe(String(DEFAULTS.port));
  });

  it('guards against fast double submits while a write is in flight', async () => {
    const storage = fakeStorage();
    let resolveSet: () => void = () => {};
    storage.set.mockImplementationOnce(
      () => new Promise<void>((r) => (resolveSet = r)),
    );
    const ctrl = initPopup(document, storage);

    const first = ctrl.save();
    const second = ctrl.save(); // fires while the first write is still pending
    resolveSet();
    await Promise.all([first, second]);

    expect(storage.set).toHaveBeenCalledTimes(1);
  });

  it('prevents Enter-key form submission from reloading the popup', async () => {
    const storage = fakeStorage();
    initPopup(document, storage);
    const event = new Event('submit', { cancelable: true });
    document.getElementById('form')!.dispatchEvent(event);
    await Promise.resolve();
    expect(event.defaultPrevented).toBe(true);
  });
});
