/**
 * Best-effort autofill for GitHub's Device Flow activation page. Pure helpers,
 * extracted so the code-resolution and field-filling logic can be unit tested
 * under jsdom; the wiring (storage read, MutationObserver) lives in device.ts.
 *
 * GitHub renders the code as nine single-character boxes (`user-code-0` …
 * `user-code-8`), where index 4 is a readonly dash. The eight editable ones
 * carry the class `js-user-code-field`. We fill those one character each. A
 * single-field layout is also handled as a fallback.
 *
 * Everything here is fail-safe: when the fields can't be matched, the caller
 * does nothing and the user types the code by hand, exactly as before.
 */

/** Strip to the alphanumerics the per-character boxes hold (the dash lives in
 * its own readonly box, so it isn't part of what we type). */
function normalize(code: string): string {
  return code.replace(/[^a-z0-9]/gi, '').toUpperCase()
}

/**
 * Resolve the code to fill. The pending login's code wins; otherwise fall back
 * to a `user_code` query param on the activation URL. Returns null when neither
 * is set.
 */
export function selectUserCode(stored: string | null, search: string): string | null {
  if (stored && stored.trim() !== '') return stored.trim()
  const fromUrl = new URLSearchParams(search).get('user_code')
  return fromUrl && fromUrl.trim() !== '' ? fromUrl.trim() : null
}

/**
 * The editable code inputs in DOM order. Prefers GitHub's per-character boxes
 * (`input.js-user-code-field`); falls back to a single field matched by its
 * stable name/id/autocomplete. Returns [] when the page has no such field
 * (e.g. the user isn't signed in yet, or this is the consent step).
 */
export function findCodeFields(doc: Document): HTMLInputElement[] {
  const split = [...doc.querySelectorAll<HTMLInputElement>('input.js-user-code-field')]
  if (split.length > 0) return split
  const single = doc.querySelector<HTMLInputElement>(
    'input[name="user_code"], input#user_code, input[autocomplete="one-time-code"]',
  )
  return single ? [single] : []
}

/** Set the value so plain and controlled inputs both register it (the native
 * prototype setter plus an `input` event is the React value-tracker trick). */
function setValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (setter) setter.call(input, value)
  else input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

/**
 * Fill the activation field(s) with the code. One field gets the whole
 * `XXXX-XXXX`; per-character boxes get one character each, but only when the
 * box count matches the code length so we can never misalign. Returns whether
 * it filled anything (fail-safe: changes nothing and returns false otherwise).
 */
export function fillCode(fields: HTMLInputElement[], code: string): boolean {
  if (fields.length === 0) return false
  if (fields.length === 1) {
    setValue(fields[0], code) // a single field expects the full XXXX-XXXX
    return true
  }
  const chars = normalize(code)
  if (fields.length !== chars.length) return false // boxes must line up 1:1
  fields.forEach((field, i) => setValue(field, chars[i]))
  return true
}
