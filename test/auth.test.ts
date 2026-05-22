import { describe, it, expect, vi } from 'vitest'
import { requestDeviceCode, pollOnce } from '../extension/src/auth'

const jsonRes = (body: unknown, ok = true) =>
  ({ ok, status: ok ? 200 : 400, json: async () => body }) as Response

describe('requestDeviceCode', () => {
  it('posts the client_id (no scope: a GitHub App defines its own permissions)', async () => {
    const fetch = vi.fn(async () =>
      jsonRes({
        device_code: 'dc',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        interval: 5,
        expires_in: 900,
      }),
    )
    const dc = await requestDeviceCode('cid', fetch as unknown as typeof globalThis.fetch)
    expect(dc.user_code).toBe('ABCD-1234')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/login/device/code')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ client_id: 'cid' })
    expect(body).not.toHaveProperty('scope')
  })

  it('throws on a non-OK response', async () => {
    const fetch = vi.fn(async () => jsonRes({}, false))
    await expect(
      requestDeviceCode('cid', fetch as unknown as typeof globalThis.fetch),
    ).rejects.toThrow()
  })
})

describe('pollOnce', () => {
  const poll = (body: unknown) =>
    pollOnce(
      'cid',
      'dc',
      vi.fn(async () => jsonRes(body)) as unknown as typeof globalThis.fetch,
    )

  it('returns the access token when granted', async () => {
    expect(await poll({ access_token: 'ghu_token' })).toEqual({
      status: 'ok',
      token: 'ghu_token',
    })
  })

  it('reports pending / slow_down without erroring', async () => {
    expect(await poll({ error: 'authorization_pending' })).toEqual({ status: 'pending' })
    expect(await poll({ error: 'slow_down' })).toEqual({ status: 'slow_down' })
  })

  it('reports an error when the user denies', async () => {
    expect(await poll({ error: 'access_denied', error_description: 'denied' })).toEqual({
      status: 'error',
      message: 'denied',
    })
  })
})
