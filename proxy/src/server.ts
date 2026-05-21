/**
 * Minimal localhost proxy for DiffsHub private-repo support.
 *
 * The extension redirects DiffsHub's client-side `GET /api/diff?path=…` fetch
 * here. We resolve it against the GitHub REST API with the diff media type
 * (`Accept: application/vnd.github.diff`) and the user's token, then return the
 * unified diff verbatim with the CORS header DiffsHub's page origin requires.
 * The token comes from `npm run login` (Device Flow) or a fallback PAT.
 */
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { loadToken } from './auth';

const ALLOWED_ORIGIN = 'https://diffshub.com';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  Vary: 'Origin',
};

export interface HandlerDeps {
  fetch: typeof fetch;
  pat: string;
}

export interface HandlerResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export async function handleDiffRequest(
  method: string,
  url: string,
  deps: HandlerDeps,
): Promise<HandlerResult> {
  if (method === 'OPTIONS') {
    return { status: 204, headers: { ...CORS_HEADERS }, body: '' };
  }

  const parsed = new URL(url, 'http://localhost');
  if (parsed.pathname !== '/api/diff') {
    return text(404, 'Not Found');
  }
  if (method !== 'GET') {
    return text(405, 'Method Not Allowed');
  }

  const path = parsed.searchParams.get('path');
  if (!path) {
    return text(400, 'Missing required query parameter: path');
  }

  // GitHub's web `.diff` endpoint ignores PAT auth for private repos, so we use
  // the REST API with the diff media type instead (works for public + private).
  const apiUrl = toApiUrl(path);
  if (!apiUrl) {
    return text(400, `Unsupported diff path: ${path}`);
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.diff',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'diffhop-proxy',
  };
  if (deps.pat.trim() !== '') {
    headers.Authorization = `Bearer ${deps.pat}`;
  }

  const upstream = await deps.fetch(apiUrl, { headers });
  const body = await upstream.text();

  return {
    status: upstream.status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
    body,
  };
}

function text(status: number, body: string): HandlerResult {
  return {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
    body,
  };
}

/**
 * Translate a GitHub page path to its REST API URL. Returns null for paths that
 * aren't a pull/commit/compare diff.
 *   /o/r/pull/123        → https://api.github.com/repos/o/r/pulls/123
 *   /o/r/commit/<sha>    → https://api.github.com/repos/o/r/commits/<sha>
 *   /o/r/compare/a...b   → https://api.github.com/repos/o/r/compare/a...b
 */
export function toApiUrl(path: string): string | null {
  const clean = path.replace(/\.(diff|patch)$/, '');
  const m = /^\/([^/]+)\/([^/]+)\/(pull|commit|compare)\/(.+)$/.exec(clean);
  if (!m) return null;
  const [, owner, repo, type, ref] = m;
  const apiType = type === 'pull' ? 'pulls' : type === 'commit' ? 'commits' : 'compare';
  return `https://api.github.com/repos/${owner}/${repo}/${apiType}/${ref}`;
}

/** Minimal `.env` loader (no runtime dependency). Existing env vars win. */
export function loadEnv(path = '.env'): void {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

export function startServer(): Server {
  loadEnv();
  const port = Number(process.env.PORT) || 7547;
  // Prefer the Device Flow token (`npm run login`); fall back to a manual PAT.
  const pat = loadToken() ?? process.env.GITHUB_PAT ?? '';

  if (pat.trim() === '') {
    console.warn(
      '[diffhop-proxy] Not authenticated — private repos will return 404. ' +
        'Run `npm run login` (or set GITHUB_PAT in .env).',
    );
  }

  const server = createServer(async (req, res) => {
    try {
      const result = await handleDiffRequest(req.method ?? 'GET', req.url ?? '/', {
        fetch,
        pat,
      });
      res.writeHead(result.status, result.headers);
      res.end(result.body);
    } catch (err) {
      console.error('[diffhop-proxy] request failed:', err);
      res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Gateway: failed to reach github.com');
    }
  });

  server.listen(port, () => {
    console.log(`[diffhop-proxy] listening on http://localhost:${port}`);
  });
  return server;
}

if (!process.env.VITEST) {
  startServer();
}
