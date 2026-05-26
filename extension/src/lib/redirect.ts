/**
 * Pure redirect policy for the github.com content script, extracted so the
 * escape / back-forward rules can be unit tested without a DOM. The content
 * script supplies the observable facts. This function decides whether to bounce
 * the tab to DiffsHub and to where.
 */
import { matchGitHubDiffUrl } from '../urls'
import { ENDPOINTS } from './config'

export interface RedirectInputs {
  href: string
  enabled: boolean
  /** The per-tab "stay on GitHub" escape is active. */
  escapeActive: boolean
  /** Arrived via Back/Forward (don't bounce the user). */
  viaHistory: boolean
}

/** The DiffsHub URL to redirect to, or null to stay on GitHub. */
export function decideRedirect(inputs: RedirectInputs): string | null {
  if (inputs.escapeActive) return null
  const match = matchGitHubDiffUrl(inputs.href)
  if (!match) return null
  if (inputs.viaHistory) return null
  if (!inputs.enabled) return null
  return `${ENDPOINTS.diffsHub}${match.path}`
}
