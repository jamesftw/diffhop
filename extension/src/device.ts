/**
 * github.com/login/device content script: fills the activation field with the
 * pending login's code so the user needn't type it. Best-effort, if the field
 * isn't there it does nothing. Fills only, never submits or authorizes, so
 * consent stays an explicit user action.
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
