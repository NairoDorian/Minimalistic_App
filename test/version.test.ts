import { describe, it, expect } from 'bun:test';
import { APP_VERSION } from '../scripts/version';

describe('Version Configuration & SemVer Semantics', () => {
  it('APP_VERSION is a valid Semantic Versioning string', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/);
  });

  it('APP_VERSION consists of non-negative integer components', () => {
    const parts = APP_VERSION.split('-')[0]!.split('.').map(Number);
    expect(parts.length).toBe(3);
    parts.forEach((n) => {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(n)).toBe(true);
    });
  });
});
