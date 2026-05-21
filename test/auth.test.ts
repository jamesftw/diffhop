import { describe, it, expect, vi } from 'vitest';
import { requestDeviceCode, pollForToken } from '../proxy/src/auth';

const jsonRes = (body: unknown, ok = true) =>
  ({ ok, status: ok ? 200 : 400, json: async () => body }) as Response;
const noSleep = async () => {};

describe('requestDeviceCode', () => {
  it('posts client_id + scope and returns the device code', async () => {
    const fetch = vi.fn(async () =>
      jsonRes({
        device_code: 'dc',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        interval: 5,
        expires_in: 900,
      }),
    );
    const dc = await requestDeviceCode('cid', 'repo', fetch as unknown as typeof globalThis.fetch);
    expect(dc.user_code).toBe('ABCD-1234');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/login/device/code');
    expect(JSON.parse(init.body as string)).toMatchObject({ client_id: 'cid', scope: 'repo' });
  });

  it('throws on a non-OK response', async () => {
    const fetch = vi.fn(async () => jsonRes({}, false));
    await expect(
      requestDeviceCode('cid', 'repo', fetch as unknown as typeof globalThis.fetch),
    ).rejects.toThrow();
  });
});

describe('pollForToken', () => {
  it('returns the access token after pending responses', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ error: 'authorization_pending' }))
      .mockResolvedValueOnce(jsonRes({ access_token: 'gho_token' }));
    const token = await pollForToken('cid', 'dc', 1, fetch as unknown as typeof globalThis.fetch, noSleep);
    expect(token).toBe('gho_token');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('honors slow_down then succeeds', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ error: 'slow_down' }))
      .mockResolvedValueOnce(jsonRes({ access_token: 'gho_x' }));
    await expect(
      pollForToken('cid', 'dc', 1, fetch as unknown as typeof globalThis.fetch, noSleep),
    ).resolves.toBe('gho_x');
  });

  it('throws when the user denies authorization', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ error: 'access_denied', error_description: 'denied' }));
    await expect(
      pollForToken('cid', 'dc', 1, fetch as unknown as typeof globalThis.fetch, noSleep),
    ).rejects.toThrow('denied');
  });
});
