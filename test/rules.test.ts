import { describe, it, expect } from 'vitest';
import { buildDynamicRules, RULE_MAIN_REDIRECT, RULE_MAIN_ALLOW } from '../extension/src/rules';

const byId = (rules: ReturnType<typeof buildDynamicRules>, id: number) =>
  rules.find((r) => r.id === id);

describe('buildDynamicRules', () => {
  it('returns no rules when disabled', () => {
    expect(buildDynamicRules({ enabled: false })).toEqual([]);
  });

  it('returns the main-frame redirect + allow rules when enabled', () => {
    const rules = buildDynamicRules({ enabled: true });
    expect(rules).toHaveLength(2);
    expect(byId(rules, RULE_MAIN_REDIRECT)).toBeDefined();
    expect(byId(rules, RULE_MAIN_ALLOW)).toBeDefined();
  });

  describe('main-frame redirect rule', () => {
    const rule = () => byId(buildDynamicRules({ enabled: true }), RULE_MAIN_REDIRECT)!;

    it('redirects GitHub diff pages to the diffshub path, main_frame only', () => {
      const r = rule();
      expect(r.condition.resourceTypes).toEqual(['main_frame']);
      expect(r.action.redirect!.regexSubstitution).toBe('https://diffshub.com\\1');
      const filter = new RegExp(r.condition.regexFilter!);
      expect(filter.test('https://github.com/o/r/pull/1')).toBe(true);
      expect(filter.test('https://github.com/o/r/commit/abc1234')).toBe(true);
      expect(filter.test('https://github.com/o/r/compare/a...b')).toBe(true);
      expect('https://github.com/o/r/pull/1/files'.match(filter)![1]).toBe('/o/r/pull/1');
    });

    it('does not match non-diff GitHub pages', () => {
      const filter = new RegExp(rule().condition.regexFilter!);
      expect(filter.test('https://github.com/o/r')).toBe(false);
      expect(filter.test('https://github.com/o/r/issues/1')).toBe(false);
    });
  });

  describe('escape allow rule', () => {
    it('exempts requests carrying the skip marker, higher priority than redirect', () => {
      const rules = buildDynamicRules({ enabled: true });
      const allow = byId(rules, RULE_MAIN_ALLOW)!;
      const redirect = byId(rules, RULE_MAIN_REDIRECT)!;
      expect(allow.action.type).toBe('allow');
      expect(allow.priority!).toBeGreaterThan(redirect.priority!);
      const filter = new RegExp(allow.condition.regexFilter!);
      expect(filter.test('https://github.com/o/r/pull/1?dh-skip=1')).toBe(true);
      expect(filter.test('https://github.com/o/r/pull/1')).toBe(false);
    });
  });
});
