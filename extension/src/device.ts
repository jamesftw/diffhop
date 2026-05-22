/**
 * Content script for GitHub's Device Flow activation page
 * (github.com/login/device). Reads the pending login's user code and fills the
 * activation field so the user doesn't have to type it.
 *
 * Best-effort and fail-safe: if the field isn't present (the user isn't signed
 * into GitHub yet, or this is the consent step), it does nothing and the manual
 * flow is unchanged. It fills and focuses the field only; it never submits the
 * form or clicks "Authorize" so consent always stays an explicit user action.
 */
import { getDevice } from './lib/storage'
import { selectUserCode, findCodeFields, fillCode } from './lib/device-fill'
import { extensionAlive } from './lib/runtime'

const FILL_TIMEOUT_MS = 8000

async function autofill(): Promise<void> {
  if (!extensionAlive()) return
  let device
  try {
    device = await getDevice()
  } catch {
    return // extension reloaded; stale tab
  }
  const stored = device && device.expires_at > Date.now() ? device.user_code : null
  const code = selectUserCode(stored, location.search)
  if (!code) return

  const tryFill = (): boolean => {
    const fields = findCodeFields(document)
    if (fields.length === 0 || fields[0].dataset.dhFilled === '1') return false
    if (!fillCode(fields, code)) return false
    for (const field of fields) field.dataset.dhFilled = '1'
    return true
  }

  if (tryFill()) return

  // The field may render after document_end; watch briefly, then give up.
  const observer = new MutationObserver(() => {
    if (tryFill()) observer.disconnect()
  })
  observer.observe(document.documentElement, { subtree: true, childList: true })
  setTimeout(() => observer.disconnect(), FILL_TIMEOUT_MS)
}

void autofill()
