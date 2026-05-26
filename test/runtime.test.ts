import { describe, it, expect, afterEach } from 'vitest'
import { extensionAlive } from '../extension/src/lib/runtime'

const g = globalThis as unknown as { chrome?: unknown }

afterEach(() => {
  delete g.chrome
})

describe('extensionAlive', () => {
  it('is false when chrome is unavailable', () => {
    delete g.chrome
    expect(extensionAlive()).toBe(false)
  })

  it('is false when the context is invalidated (runtime has no id)', () => {
    g.chrome = { runtime: {} }
    expect(extensionAlive()).toBe(false)
  })

  it('is true when runtime.id is present', () => {
    g.chrome = { runtime: { id: 'abc123' } }
    expect(extensionAlive()).toBe(true)
  })
})
