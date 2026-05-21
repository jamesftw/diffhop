/**
 * Proxy configuration. The GitHub OAuth App Client ID is public (it ships with
 * the app, like the `gh` CLI bundles its own) — the Device Flow needs no secret.
 * Overridable via the GITHUB_CLIENT_ID env var.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || 'Ov23liODx8sAMhf2l7Ma';

/** Scope requested at login. `repo` grants read access to private repo diffs. */
export const OAUTH_SCOPE = 'repo';

export const TOKEN_DIR = join(homedir(), '.diffhop');
export const TOKEN_FILE = join(TOKEN_DIR, 'token.json');
