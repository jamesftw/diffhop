import { describe, it, expect } from 'vitest'
import { decideRedirect, type RedirectInputs } from '../extension/src/lib/redirect'

const base: RedirectInputs = {
  href: 'https://github.com/o/r/pull/5',
  enabled: true,
  escapeActive: false,
  viaHistory: false,
}

describe('decideRedirect', () => {
  it('redirects a diff page to the matching DiffsHub path', () => {
    expect(decideRedirect(base)).toBe('https://diffshub.com/o/r/pull/5')
  })

  it('stays put when the escape is active', () => {
    expect(decideRedirect({ ...base, escapeActive: true })).toBeNull()
  })

  it('stays put when the page is not a diff', () => {
    expect(
      decideRedirect({ ...base, href: 'https://github.com/o/r/issues/1' }),
    ).toBeNull()
  })

  it('stays put when arriving via Back/Forward', () => {
    expect(decideRedirect({ ...base, viaHistory: true })).toBeNull()
  })

  it('stays put when the feature is disabled', () => {
    expect(decideRedirect({ ...base, enabled: false })).toBeNull()
  })

  it('normalizes sub-tabs / query / suffix to the canonical path', () => {
    expect(
      decideRedirect({ ...base, href: 'https://github.com/o/r/pull/5/files?w=1' }),
    ).toBe('https://diffshub.com/o/r/pull/5')
  })
})
