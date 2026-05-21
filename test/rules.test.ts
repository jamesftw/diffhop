import { describe, it, expect } from 'vitest';
import {
  buildDynamicRules,
  RULE_MAIN_REDIRECT,
  RULE_MAIN_ALLOW,
  RULE_API_REDIRECT,
} from '../extension/src/rules';

const base = { enabled: true, port: 7547, pat: 'ghp_token' };

const byId = (rules: ReturnType<typeof buildDynamicRules>, id: number) =>
  rules.find((r) => r.id === id);

describe('buildDynamicRules', () => {
  it('includes the main redirect + allow rules when enabled (no PAT)', () => {
    const rules = buildDynamicRules({ ...base, pat: '' });
    expect(byId(rules, RULE_MAIN_REDIRECT)).toBeDefined();
    expect(byId(rules, RULE_MAIN_ALLOW)).toBeDefined();
    expect(byId(rules, RULE_API_REDIRECT)).toBeUndefined();
  });

  it('adds the /api/diff rule when a PAT is present', () => {
    expect(byId(buildDynamicRules(base), RULE_API_REDIRECT)).toBeDefined();
  });

  it('returns no rules when disabled', () => {
    expect(buildDynamicRules({ ...base, enabled: false })).toEqual([]);
  });

  describe('main-frame redirect rule', () => {
    const rule = () => byId(buildDynamicRules(base), RULE_MAIN_REDIRECT)!;

    it('redirects GitHub diff pages to the diffshub path, main_frame only', () => {
      const r = rule();
      expect(r.condition.resourceTypes).toEqual(['main_frame']);
      expect(r.action.redirect!.regexSubstitution).toBe('https://diffshub.com\\1');
      const filter = new RegExp(r.condition.regexFilter!);
      expect(filter.test('https://github.com/o/r/pull/1')).toBe(true);
      expect(filter.test('https://github.com/o/r/commit/abc1234')).toBe(true);
      expect(filter.test('https://github.com/o/r/compare/a...b')).toBe(true);
      // captures the canonical path, dropping sub-tabs / suffix
      expect('https://github.com/o/r/pull/1/files'.match(filter)![1]).toBe('/o/r/pull/1');
      expect('https://github.com/o/r/pull/1.diff'.match(filter)![1]).toBe('/o/r/pull/1');
    });

    it('does not match non-diff GitHub pages', () => {
      const filter = new RegExp(rule().condition.regexFilter!);
      expect(filter.test('https://github.com/o/r')).toBe(false);
      expect(filter.test('https://github.com/o/r/issues/1')).toBe(false);
    });
  });

  describe('escape allow rule', () => {
    it('exempts requests carrying the skip marker, higher priority than redirect', () => {
      const rules = buildDynamicRules(base);
      const allow = byId(rules, RULE_MAIN_ALLOW)!;
      const redirect = byId(rules, RULE_MAIN_REDIRECT)!;
      expect(allow.action.type).toBe('allow');
      expect(allow.priority!).toBeGreaterThan(redirect.priority!);
      const filter = new RegExp(allow.condition.regexFilter!);
      expect(filter.test('https://github.com/o/r/pull/1?dh-skip=1')).toBe(true);
      expect(filter.test('https://github.com/o/r/pull/1')).toBe(false);
    });
  });

  describe('/api/diff → localhost rule', () => {
    const rule = () => byId(buildDynamicRules(base), RULE_API_REDIRECT)!;

    it('redirects diffshub /api/diff to the localhost proxy, scoped to diffshub', () => {
      const r = rule();
      expect(r.condition.resourceTypes).toEqual(['xmlhttprequest']);
      expect(r.condition.initiatorDomains).toEqual(['diffshub.com']);
      expect(r.action.redirect!.regexSubstitution).toBe('http://localhost:7547/api/diff?\\1');
    });

    it('uses the configured port, falling back to default when invalid', () => {
      expect(byId(buildDynamicRules({ ...base, port: 9000 }), RULE_API_REDIRECT)!
        .action.redirect!.regexSubstitution).toContain(':9000/');
      expect(byId(buildDynamicRules({ ...base, port: 0 }), RULE_API_REDIRECT)!
        .action.redirect!.regexSubstitution).toContain(':7547/');
    });
  });
});
