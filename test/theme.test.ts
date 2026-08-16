import { describe, it, expect } from 'bun:test';
import { THEME_PRESETS, DEFAULT_THEME_ACCENT } from '../src/lib/theme';

describe('Theme Accent Engine', () => {
  it('contains the standard 5 theme presets', () => {
    expect(THEME_PRESETS.length).toBe(5);
    const ids = THEME_PRESETS.map((p) => p.id);
    expect(ids).toContain('cyan');
    expect(ids).toContain('emerald');
    expect(ids).toContain('violet');
    expect(ids).toContain('amber');
    expect(ids).toContain('rose');
  });

  it('default theme accent is cyan', () => {
    expect(DEFAULT_THEME_ACCENT).toBe('cyan');
    const defaultPreset = THEME_PRESETS.find((p) => p.id === DEFAULT_THEME_ACCENT);
    expect(defaultPreset).toBeDefined();
    expect(defaultPreset?.primary).toBe('#00f2fe');
  });

  it('all presets have valid hex colors and rgba glows', () => {
    for (const preset of THEME_PRESETS) {
      expect(preset.primary).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(preset.secondary).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(preset.glow).toMatch(/^rgba\(/);
      expect(preset.badgeBg).toMatch(/^rgba\(/);
    }
  });
});
