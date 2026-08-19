import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { THEME_PRESETS, DEFAULT_THEME_ACCENT, applyThemeAccent } from '../src/lib/theme';

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

  it('each preset id is unique', () => {
    const ids = THEME_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('applyThemeAccent', () => {
  let originalDocument: typeof globalThis.document | undefined;
  const setPropertyCalls: Record<string, string> = {};

  beforeAll(() => {
    originalDocument = globalThis.document;
    globalThis.document = {
      documentElement: {
        style: {
          setProperty: (prop: string, value: string) => {
            setPropertyCalls[prop] = value;
          },
        },
      },
    } as unknown as typeof globalThis.document;
  });

  afterAll(() => {
    if (originalDocument !== undefined) {
      globalThis.document = originalDocument;
    } else {
      // @ts-expect-error — clearing the mock
      delete globalThis.document;
    }
  });

  it('applies CSS variables for a known accent', () => {
    const result = applyThemeAccent('emerald');
    expect(result).toBe('emerald');
    const emerald = THEME_PRESETS.find((p) => p.id === 'emerald')!;
    expect(setPropertyCalls['--accent-cyan']).toBe(emerald.primary);
    expect(setPropertyCalls['--accent-blue']).toBe(emerald.secondary);
    expect(setPropertyCalls['--accent-glow']).toBe(emerald.glow);
    expect(setPropertyCalls['--accent-badge-bg']).toBe(emerald.badgeBg);
  });

  it('falls back to the first preset for an unknown accent', () => {
    const result = applyThemeAccent('nonexistent-accent');
    expect(result).toBe(THEME_PRESETS[0]!.id);
  });

  it('falls back to the first preset for undefined', () => {
    const result = applyThemeAccent(undefined);
    expect(result).toBe(THEME_PRESETS[0]!.id);
  });
});
