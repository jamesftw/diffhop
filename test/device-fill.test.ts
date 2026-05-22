// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  selectUserCode,
  findCodeFields,
  fillCode,
} from '../extension/src/lib/device-fill'

/** GitHub's real activation markup: nine single-char boxes, index 4 a readonly
 * dash, the eight editable ones carrying class js-user-code-field. */
function githubDeviceForm(): void {
  const box = (i: number, editable = true) =>
    editable
      ? `<input type="text" name="user-code-${i}" id="user-code-${i}" class="form-control js-user-code-field h1" maxlength="1">`
      : `<input type="text" name="user-code-${i}" id="user-code-${i}" class="d-none" value="-" readonly>`
  document.body.innerHTML = `<form>
    ${box(0)}${box(1)}${box(2)}${box(3)}${box(4, false)}${box(5)}${box(6)}${box(7)}${box(8)}
    <input type="submit" name="commit" value="Continue">
  </form>`
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('selectUserCode', () => {
  it('prefers the stored code over the URL', () => {
    expect(selectUserCode('ABCD-1234', '?user_code=WXYZ-0000')).toBe('ABCD-1234')
  })

  it('falls back to the user_code query param', () => {
    expect(selectUserCode(null, '?user_code=WXYZ-0000')).toBe('WXYZ-0000')
    expect(selectUserCode('   ', '?user_code=WXYZ-0000')).toBe('WXYZ-0000')
  })

  it('returns null when neither source has a code', () => {
    expect(selectUserCode(null, '')).toBeNull()
    expect(selectUserCode('', '?foo=bar')).toBeNull()
  })
})

describe('findCodeFields', () => {
  it("returns GitHub's eight editable boxes, skipping the dash and submit", () => {
    githubDeviceForm()
    const fields = findCodeFields(document)
    expect(fields.map((f) => f.name)).toEqual([
      'user-code-0',
      'user-code-1',
      'user-code-2',
      'user-code-3',
      'user-code-5',
      'user-code-6',
      'user-code-7',
      'user-code-8',
    ])
  })

  it('falls back to a single named field', () => {
    document.body.innerHTML = '<input name="user_code">'
    expect(findCodeFields(document).map((f) => f.getAttribute('name'))).toEqual([
      'user_code',
    ])
  })

  it('never matches generic fields', () => {
    document.body.innerHTML = '<input type="search" name="q"><input type="password">'
    expect(findCodeFields(document)).toEqual([])
  })
})

describe('fillCode', () => {
  it('fills one character per box, leaving the dash box untouched', () => {
    githubDeviceForm()
    const filled = fillCode(findCodeFields(document), 'ABCD-1234')
    expect(filled).toBe(true)
    const valueOf = (id: string) =>
      document.querySelector<HTMLInputElement>(`#${id}`)!.value
    expect([0, 1, 2, 3, 5, 6, 7, 8].map((i) => valueOf(`user-code-${i}`)).join('')).toBe(
      'ABCD1234',
    )
    expect(valueOf('user-code-4')).toBe('-') // readonly dash untouched
  })

  it('dispatches an input event on each box', () => {
    githubDeviceForm()
    const onInput = vi.fn()
    findCodeFields(document).forEach((f) => f.addEventListener('input', onInput))
    fillCode(findCodeFields(document), 'ABCD-1234')
    expect(onInput).toHaveBeenCalledTimes(8)
  })

  it('puts the whole code in a single field', () => {
    document.body.innerHTML = '<input name="user_code">'
    fillCode(findCodeFields(document), 'ABCD-1234')
    expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('ABCD-1234')
  })

  it('refuses to fill when the box count does not match the code length', () => {
    githubDeviceForm() // 8 boxes
    expect(fillCode(findCodeFields(document), 'ABC-123')).toBe(false) // 6 chars
    expect(document.querySelector<HTMLInputElement>('#user-code-0')!.value).toBe('')
  })

  it('returns false when there are no fields', () => {
    expect(fillCode([], 'ABCD-1234')).toBe(false)
  })
})
