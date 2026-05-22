/**
 * Guard for content scripts after an extension reload. Injected content scripts
 * keep running when the extension is reloaded or updated, but their `chrome.*`
 * handle is dead, and calling it throws "Extension context invalidated". Check
 * this before touching chrome APIs so a stale tab fails quietly (the user just
 * refreshes) instead of spewing errors into the page console.
 */
export function extensionAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id)
  } catch {
    return false
  }
}
