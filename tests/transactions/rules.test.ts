/**
 * Rule engine logic unit tests — pure matching logic only (no DB).
 * Tests the pattern matching behavior expected by applyVendorRules.
 */
import { describe, it, expect } from 'vitest';

// Rule matching logic extracted to a pure function for testing
function ruleMatches(description: string, pattern: string, matchType: 'contains' | 'starts_with' | 'exact'): boolean {
  const desc = description.toUpperCase();
  const pat = pattern.toUpperCase();
  switch (matchType) {
    case 'exact':       return desc === pat;
    case 'starts_with': return desc.startsWith(pat);
    case 'contains':    return desc.includes(pat);
  }
}

describe('Rule engine — contains match', () => {
  it('matches substring anywhere in description', () => {
    expect(ruleMatches('COPART ONLINE BUYING FEE #12345', 'COPART', 'contains')).toBe(true);
  });

  it('matches in the middle of description', () => {
    expect(ruleMatches('PAYMENT TO JIFFY LUBE #4521', 'JIFFY LUBE', 'contains')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(ruleMatches('autozone #123', 'AUTOZONE', 'contains')).toBe(true);
  });

  it('does not match partial word incorrectly', () => {
    expect(ruleMatches('AUTOCOP SECURITY', 'AUTOZONE', 'contains')).toBe(false);
  });

  it('returns false when pattern not present', () => {
    expect(ruleMatches('CHEVRON GAS STATION', 'COPART', 'contains')).toBe(false);
  });
});

describe('Rule engine — starts_with match', () => {
  it('matches description starting with pattern', () => {
    expect(ruleMatches('MANHEIM PHOENIX AUCTION 03/2026', 'MANHEIM', 'starts_with')).toBe(true);
  });

  it('does not match when pattern is in the middle', () => {
    expect(ruleMatches('PAYMENT TO MANHEIM', 'MANHEIM', 'starts_with')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(ruleMatches('manheim tucson #456', 'MANHEIM', 'starts_with')).toBe(true);
  });
});

describe('Rule engine — exact match', () => {
  it('matches only the exact string', () => {
    expect(ruleMatches('GEICO INSURANCE', 'GEICO INSURANCE', 'exact')).toBe(true);
  });

  it('does not match partial', () => {
    expect(ruleMatches('GEICO INSURANCE PAYMENT', 'GEICO INSURANCE', 'exact')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(ruleMatches('geico insurance', 'GEICO INSURANCE', 'exact')).toBe(true);
  });
});

describe('Rule priority — first matching rule wins', () => {
  interface Rule { vendor_pattern: string; match_type: 'contains' | 'starts_with' | 'exact'; category: string }

  function applyRules(description: string, rules: Rule[]): string | null {
    const desc = description.toUpperCase();
    for (const rule of rules) {
      const pat = rule.vendor_pattern.toUpperCase();
      const matched =
        rule.match_type === 'exact'       ? desc === pat :
        rule.match_type === 'starts_with' ? desc.startsWith(pat) :
                                            desc.includes(pat);
      if (matched) return rule.category;
    }
    return null;
  }

  const rules: Rule[] = [
    { vendor_pattern: 'COPART ONLINE', match_type: 'starts_with', category: 'Auction Fee' },
    { vendor_pattern: 'COPART',        match_type: 'contains',    category: 'Transport' },
  ];

  it('returns category from first matching rule', () => {
    expect(applyRules('COPART ONLINE BUYING', rules)).toBe('Auction Fee');
  });

  it('falls through to second rule when first does not match', () => {
    expect(applyRules('COPART TRANSPORT LLC', rules)).toBe('Transport');
  });

  it('returns null when no rule matches', () => {
    expect(applyRules('STARBUCKS COFFEE', rules)).toBeNull();
  });
});

describe('Category validation', () => {
  const VALID = [
    'Transport', 'Auction Fee', 'Mechanical', 'Body/Paint', 'Detail',
    'Registration', 'Parts', 'Photography', 'Marketing', 'Overhead', 'Other',
  ];

  it('all expected categories are in the list', () => {
    expect(VALID).toContain('Transport');
    expect(VALID).toContain('Overhead');
    expect(VALID).toContain('Auction Fee');
  });

  it('list has exactly 11 categories', () => {
    expect(VALID).toHaveLength(11);
  });

  it('has no duplicate entries', () => {
    expect(new Set(VALID).size).toBe(VALID.length);
  });
});
