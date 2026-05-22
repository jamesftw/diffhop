/**
 * Pure redirect policy for the github.com content script, extracted so the
 * escape / back-forward rules can be unit tested without a DOM. The content
 * script supplies the observable facts; this function decides whether to bounce
 * the tab to DiffsHub and to where.
 */
import { matchGitHubDiffUrl } from '../urls'
import { ENDPOINTS } from './config'

export interface RedirectInputs {
  /** The current `location.href`. */
  href: string
  /** Whether the redirect feature is enabled. */
  enabled: boolean
  /** Whether the per-tab "stay on GitHub" escape is active. */
  escapeActive: boolean
  /** Whether this navigation arrived via Back/Forward (then leave it be). */
  viaHistory: boolean
}

/**
 * Returns the DiffsHub URL to redirect to, or `null` to stay put. We stay when
 * the escape is active, the page isn't a diff, the user navigated here via
 * Back/Forward, or the feature is disabled.
 */
export function decideRedirect(inputs: RedirectInputs): string | null {
  if (inputs.escapeActive) return null
  const match = matchGitHubDiffUrl(inputs.href)
  if (!match) return null
  if (inputs.viaHistory) return null
  if (!inputs.enabled) return null
  return `${ENDPOINTS.diffsHub}${match.path}`
}
