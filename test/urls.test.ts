import { describe, it, expect } from 'vitest';
import { matchGitHubDiffUrl, toDiffsHubUrl, toApiUrl } from '../extension/src/urls';

describe('matchGitHubDiffUrl', () => {
  it('matches a pull request URL', () => {
    expect(matchGitHubDiffUrl('https://github.com/facebook/react/pull/28000')).toEqual({
      path: '/facebook/react/pull/28000',
    });
  });

  it('matches a commit URL (full 40-char sha)', () => {
    const sha = 'a'.repeat(40);
    expect(matchGitHubDiffUrl(`https://github.com/o/r/commit/${sha}`)).toEqual({
      path: `/o/r/commit/${sha}`,
    });
  });

  it('matches a commit URL (abbreviated 7-char sha)', () => {
    expect(matchGitHubDiffUrl('https://github.com/o/r/commit/abc1234')).toEqual({
      path: '/o/r/commit/abc1234',
    });
  });

  it('matches a three-dot compare URL', () => {
    expect(matchGitHubDiffUrl('https://github.com/o/r/compare/main...feature')).toEqual({
      path: '/o/r/compare/main...feature',
    });
  });

  it('matches a two-dot compare URL', () => {
    expect(matchGitHubDiffUrl('https://github.com/o/r/compare/v1.0..v2.0')).toEqual({
      path: '/o/r/compare/v1.0..v2.0',
    });
  });

  it('normalizes a .diff suffix to the canonical base path', () => {
    expect(matchGitHubDiffUrl('https://github.com/o/r/pull/5.diff')).toEqual({
      path: '/o/r/pull/5',
    });
  });

  it('normalizes a .patch suffix to the canonical base path', () => {
    expect(matchGitHubDiffUrl('https://github.com/o/r/pull/5.patch')).toEqual({
      path: '/o/r/pull/5',
    });
  });

  it('strips PR sub-tabs like /files and /commits', () => {
    expect(matchGitHubDiffUrl('https://github.com/o/r/pull/5/files')?.path).toBe('/o/r/pull/5');
    expect(matchGitHubDiffUrl('https://github.com/o/r/pull/5/commits')?.path).toBe('/o/r/pull/5');
  });

  it('strips query strings and hash fragments', () => {
    expect(matchGitHubDiffUrl('https://github.com/o/r/pull/5?w=1')?.path).toBe('/o/r/pull/5');
    expect(matchGitHubDiffUrl('https://github.com/o/r/pull/5#diff-abc')?.path).toBe('/o/r/pull/5');
  });

  it.each([
    ['bare repo root', 'https://github.com/facebook/react'],
    ['issues page', 'https://github.com/o/r/issues/1'],
    ['non-numeric pull', 'https://github.com/o/r/pull/abc'],
    ['blob/source view', 'https://github.com/o/r/blob/main/index.js'],
    ['commits list (plural)', 'https://github.com/o/r/commits/main'],
    ['non-hex commit sha', 'https://github.com/o/r/commit/zzzzzzz'],
    ['settings', 'https://github.com/settings/tokens'],
    ['different host', 'https://gitlab.com/o/r/pull/5'],
    ['http (not https)', 'http://github.com/o/r/pull/5'],
    ['lookalike host', 'https://github.com.evil.com/o/r/pull/5'],
  ])('rejects %s', (_label, url) => {
    expect(matchGitHubDiffUrl(url)).toBeNull();
  });
});

describe('toDiffsHubUrl', () => {
  it('rewrites the host to diffshub.com and preserves the path', () => {
    expect(toDiffsHubUrl('https://github.com/facebook/react/pull/28000')).toBe(
      'https://diffshub.com/facebook/react/pull/28000',
    );
  });

  it('returns null for non-diff URLs', () => {
    expect(toDiffsHubUrl('https://github.com/facebook/react')).toBeNull();
  });
});

describe('toApiUrl', () => {
  it.each([
    ['/o/r/pull/123', 'https://api.github.com/repos/o/r/pulls/123'],
    ['/o/r/pull/123.diff', 'https://api.github.com/repos/o/r/pulls/123'],
    ['/o/r/commit/abc1234', 'https://api.github.com/repos/o/r/commits/abc1234'],
    ['/o/r/compare/main...feature', 'https://api.github.com/repos/o/r/compare/main...feature'],
  ])('maps %s → %s', (path, expected) => {
    expect(toApiUrl(path)).toBe(expected);
  });

  it('returns null for non-diff paths', () => {
    expect(toApiUrl('/o/r')).toBeNull();
    expect(toApiUrl('/o/r/issues/1')).toBeNull();
  });
});
