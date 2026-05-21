/**
 * Minimal localhost proxy for DiffsHub private-repo support.
 *
 * The extension redirects DiffsHub's client-side `GET /api/diff?path=…` fetch
 * here. We forward it to `https://github.com{path}.diff` with the configured
 * PAT and return the raw unified diff verbatim, with the CORS header DiffsHub's
 * page origin requires.
 */
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';

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

  // DiffsHub passes the page path; GitHub serves the diff at `{path}.diff`.
  // Strip any existing suffix so we never request `…/1.diff.diff`.
  const base = path.replace(/\.(diff|patch)$/, '');
  const githubUrl = `https://github.com${base}.diff`;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3.diff, text/plain',
    'User-Agent': 'diffshub-redirect-proxy',
  };
  if (deps.pat.trim() !== '') {
    headers.Authorization = `Bearer ${deps.pat}`;
  }

  const upstream = await deps.fetch(githubUrl, { headers });
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
  const pat = process.env.GITHUB_PAT ?? '';

  if (pat.trim() === '') {
    console.warn(
      '[diffshub-proxy] No GITHUB_PAT set — private repos will return 404. ' +
        'Copy .env.example to .env and add a token.',
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
      console.error('[diffshub-proxy] request failed:', err);
      res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Gateway: failed to reach github.com');
    }
  });

  server.listen(port, () => {
    console.log(`[diffshub-proxy] listening on http://localhost:${port}`);
  });
  return server;
}

if (!process.env.VITEST) {
  startServer();
}
