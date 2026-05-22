import { chromium } from 'playwright-core'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const ext = path.resolve('dist')
const STORAGE_KEY = 'diffshub-config'
const TOKEN_KEY = 'diffshub-token'
const results = []

// Optional: a real GitHub token enables the proxy-free private-diff check.
let realToken = ''
try {
  realToken =
    JSON.parse(readFileSync(path.join(homedir(), '.diffhop/token.json'), 'utf8'))
      .access_token || ''
} catch {
  /* no token — that check is skipped */
}

function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name} — ${detail}`)
}

async function setConfig(sw, cfg) {
  await sw.evaluate(
    ([key, value]) => chrome.storage.sync.set({ [key]: value }),
    [STORAGE_KEY, cfg],
  )
}

// Bundled Chromium (no `channel`) still honors --load-extension; branded
// Chrome 137+ ignores the flag, so we use Chromium for automated checks.
const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  viewport: { width: 1100, height: 800 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
})

async function getServiceWorker() {
  let sw = ctx.serviceWorkers()[0]
  if (!sw) {
    try {
      sw = await ctx.waitForEvent('serviceworker', { timeout: 8000 })
    } catch {
      return null
    }
  }
  return sw
}

const page = await ctx.newPage()

async function expectRedirect(name, url) {
  // Reset to a real (non-diff) github page; the redirect aborts the target
  // goto (ERR_ABORTED), then the diffshub navigation lands a moment later, so
  // we poll page.url() rather than race waitForURL.
  await page.goto('https://github.com', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.goto(url, { waitUntil: 'commit' }).catch(() => {})
  for (let i = 0; i < 15; i++) {
    if (/^https:\/\/diffshub\.com\//.test(page.url())) break
    await page.waitForTimeout(800)
  }
  const ok = /^https:\/\/diffshub\.com\//.test(page.url())
  record(name, ok, ok ? `→ ${page.url()}` : `stayed at ${page.url()}`)
}

async function expectNoRedirect(name, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    const stayed = page.url().startsWith('https://github.com/')
    record(
      name,
      stayed,
      stayed ? `stayed on github (${page.url()})` : `redirected to ${page.url()}`,
    )
  } catch (e) {
    record(name, false, `error: ${e.message}`)
  }
}

// --- enabled, no PAT (public-repo path) ---
await expectRedirect('Direct PR redirect', 'https://github.com/facebook/react/pull/28000')
await expectRedirect(
  'Commit redirect',
  'https://github.com/facebook/react/commit/0b08c0e7',
)
await expectRedirect(
  'Compare (3-dot) redirect',
  'https://github.com/facebook/react/compare/v18.2.0...v18.3.0',
)
await expectRedirect(
  '.diff suffix → base redirect',
  'https://github.com/facebook/react/pull/28000.diff',
)

// non-diff URL should be left alone
await expectNoRedirect('Non-diff URL not redirected', 'https://github.com/facebook/react')

// --- SPA navigation (content-script fallback) ---
// Land on a non-diff github page, then simulate GitHub's in-page nav: change
// the URL via pushState AND mutate the DOM (what Turbo does). Our content
// script's MutationObserver should observe the href change and redirect.
try {
  await page.goto('https://github.com/facebook/react', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1000)
  await page.evaluate(() => {
    history.pushState({}, '', '/facebook/react/pull/26000')
    document.body.appendChild(document.createElement('div')) // trigger MutationObserver
    window.dispatchEvent(new Event('turbo:load')) // GitHub's Turbo nav signal
  })
  await page.waitForURL(/^https:\/\/diffshub\.com\//, { timeout: 15000 })
  record('SPA (pushState) navigation redirect', true, `→ ${page.url()}`)
} catch {
  record('SPA (pushState) navigation redirect', false, `stayed at ${page.url()}`)
}

// --- toggle OFF (the navigations above will have woken the service worker) ---
const sw = await getServiceWorker()
if (sw) {
  console.log('Service worker:', sw.url())
  await setConfig(sw, { enabled: false })
  await page.waitForTimeout(700)
  await expectNoRedirect(
    'Toggle OFF disables redirect',
    'https://github.com/facebook/react/pull/28000',
  )
  await setConfig(sw, { enabled: true })
} else {
  record(
    'Toggle OFF disables redirect',
    false,
    'could not reach service worker (inconclusive)',
  )
}

// --- escape back to GitHub (A′) — run on a fresh tab so the sticky
//     per-tab flag doesn't bleed into the redirect checks above ---
{
  const esc = await ctx.newPage()

  // 1. DiffsHub tags its "View on GitHub" link with the skip marker.
  try {
    await esc.goto('https://diffshub.com/facebook/react/pull/28000', {
      waitUntil: 'domcontentloaded',
    })
    await esc.waitForFunction(
      () =>
        [...document.querySelectorAll('a[href*="github.com"]')].some((a) =>
          a.href.includes('dh-skip'),
        ),
      { timeout: 10000 },
    )
    const href = await esc.$eval('a[href*="dh-skip"]', (a) => a.href)
    record('DiffsHub tags "View on GitHub" link', true, href)
  } catch {
    record('DiffsHub tags "View on GitHub" link', false, 'no tagged link found')
  }

  // 2. Arriving at GitHub with the marker is NOT redirected (dNR allow rule),
  //    and the content script strips the marker.
  await esc.goto('https://github.com/facebook/react/pull/28000?dh-skip=1', {
    waitUntil: 'domcontentloaded',
  })
  await esc.waitForTimeout(2500)
  const onGithubClean =
    esc.url().startsWith('https://github.com/') && !esc.url().includes('dh-skip')
  record('Marker escapes redirect (and is cleaned)', onGithubClean, esc.url())

  // 3. Escape is sticky: in-page navigation to another diff stays on GitHub.
  await esc.evaluate(() => {
    history.pushState({}, '', '/facebook/react/pull/27000')
    document.body.appendChild(document.createElement('div'))
    window.dispatchEvent(new Event('turbo:load'))
  })
  await esc.waitForTimeout(2000)
  record(
    'Escape is sticky across in-page nav',
    esc.url().startsWith('https://github.com/'),
    esc.url(),
  )

  // 4. Clicking DiffsHub's real "View on GitHub" link opens the GitHub PR
  //    (new tab) and is NOT bounced back to DiffsHub.
  const dh = await ctx.newPage()
  await dh.goto('https://diffshub.com/facebook/react/pull/28000', {
    waitUntil: 'domcontentloaded',
  })
  await dh.waitForSelector('a[href*="dh-skip"]', { timeout: 10000 }).catch(() => {})
  // The link is target="_blank" — capture the new tab it opens.
  const [ghTab] = await Promise.all([
    ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null),
    dh
      .locator('a[href*="github.com"]')
      .first()
      .click()
      .catch(() => {}),
  ])
  if (ghTab) await ghTab.waitForTimeout(3500)
  const url = ghTab ? ghTab.url() : ''
  const linkOk =
    url.startsWith('https://github.com/') &&
    url.includes('/pull/28000') &&
    !url.includes('dh-skip')
  record(
    '"View on GitHub" link reaches GitHub (not bounced)',
    linkOk,
    url || 'no new tab opened',
  )
  if (ghTab) await ghTab.close()
  await dh.close()

  await esc.close()
}

// --- Back returns to the PR list (dNR redirect is transparent: it leaves no
//     GitHub diff history entry, so Back skips straight past it) ---
{
  const bk = await ctx.newPage()
  await bk.goto('https://github.com/facebook/react/pulls', {
    waitUntil: 'domcontentloaded',
  })
  await bk.waitForTimeout(2000)
  await bk
    .locator('a[href*="/facebook/react/pull/"]')
    .first()
    .click()
    .catch(() => {})
  for (let i = 0; i < 15; i++) {
    if (/diffshub\.com/.test(bk.url())) break
    await bk.waitForTimeout(700)
  }
  const redirected = /^https:\/\/diffshub\.com\//.test(bk.url())
  await bk.goBack().catch(() => {})
  await bk.waitForTimeout(2500)
  const backToList =
    bk.url().startsWith('https://github.com/') && bk.url().includes('/pulls')
  record('Back from DiffsHub returns to the PR list', redirected && backToList, bk.url())
  await bk.close()
}

// --- Proxy-free private diff: with a token in storage, DiffsHub's /api/diff is
//     served by the extension (background → GitHub API). Skipped without a token. ---
if (realToken && sw) {
  await sw.evaluate(async (tok) => {
    await chrome.storage.local.set({ 'diffshub-token': tok })
  }, realToken)
  const pf = await ctx.newPage()
  await pf.goto('https://diffshub.com/JamesFTW/swoleweb/pull/89', {
    waitUntil: 'domcontentloaded',
  })
  await pf.waitForTimeout(6000)
  const txt = await pf.evaluate(() => document.body.innerText).catch(() => '')
  const loaded =
    !/Couldn.t load/i.test(txt) && /Additions|Deletions|diff --git/i.test(txt)
  record(
    'Proxy-free: private diff loads via in-browser GitHub API',
    loaded,
    loaded ? 'rendered' : 'not loaded',
  )
  await pf.close()
  await sw.evaluate(() => chrome.storage.local.remove('diffshub-token'))
} else {
  console.log('ℹ️  Proxy-free private check skipped (no ~/.diffhop/token.json)')
}

console.log('\n=== SUMMARY ===')
const passed = results.filter((r) => r.ok).length
console.log(`${passed}/${results.length} checks passed`)

await page.waitForTimeout(2000)
await ctx.close()
process.exit(passed === results.length ? 0 : 1)
