/**
 * Theme Accent Personalization Engine.
 *
 * Provides curated, accessible accent color palettes that dynamically bind
 * to CSS custom properties (--accent-cyan, --accent-blue, --accent-glow) on the document root.
 */

import { storageKey } from './appMeta';

export type ThemeAccent = 'cyan' | 'emerald' | 'violet' | 'amber' | 'rose';

/**
 * localStorage key backing the accent in browser-preview mode. The desktop
 * build persists the accent through `AppSettings` on the Rust side instead.
 */
export const THEME_ACCENT_STORAGE_KEY = storageKey('theme_accent');

export interface ThemePreset {
  id: ThemeAccent;
  name: string;
  primary: string;
  secondary: string;
  glow: string;
  badgeBg: string;
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: 'cyan',
    name: 'Cyan Glow',
    primary: '#00f2fe',
    secondary: '#4facfe',
    glow: 'rgba(0, 242, 254, 0.25)',
    badgeBg: 'rgba(0, 242, 254, 0.08)',
  },
  {
    id: 'emerald',
    name: 'Emerald Matrix',
    primary: '#10b981',
    secondary: '#34d399',
    glow: 'rgba(16, 185, 129, 0.25)',
    badgeBg: 'rgba(16, 185, 129, 0.08)',
  },
  {
    id: 'violet',
    name: 'Violet Neon',
    primary: '#a855f7',
    secondary: '#c084fc',
    glow: 'rgba(168, 85, 247, 0.25)',
    badgeBg: 'rgba(168, 85, 247, 0.08)',
  },
  {
    id: 'amber',
    name: 'Amber Gold',
    primary: '#f59e0b',
    secondary: '#fbbf24',
    glow: 'rgba(245, 158, 11, 0.25)',
    badgeBg: 'rgba(245, 158, 11, 0.08)',
  },
  {
    id: 'rose',
    name: 'Rose Pink',
    primary: '#f43f5e',
    secondary: '#fb7185',
    glow: 'rgba(244, 63, 94, 0.25)',
    badgeBg: 'rgba(244, 63, 94, 0.08)',
  },
] as const;

export const DEFAULT_THEME_ACCENT: ThemeAccent = 'cyan';

/**
 * Resolves a stored accent id to a known preset, falling back to the default.
 *
 * Pure — no DOM access — so it is safe to call from a `createMemo` compute,
 * which must stay side-effect free. `applyThemeAccent` is the effectful half.
 */
export function resolveThemeAccent(accent: string | null | undefined): ThemeAccent {
  return (THEME_PRESETS.find((p) => p.id === accent) ?? THEME_PRESETS[0]!).id;
}

/**
 * Applies the selected theme accent preset to document CSS variables.
 *
 * This is an imperative boundary (the document's style object), so it belongs
 * in an effect's apply phase rather than in a memo — see
 * `.docs/solid-docs/src/routes/(5)guides/(0)avoid-unnecessary-effects.mdx`.
 */
export function applyThemeAccent(accent: string | undefined): ThemeAccent {
  const selected = THEME_PRESETS.find((p) => p.id === accent) ?? THEME_PRESETS[0]!;
  const root = document.documentElement;

  root.style.setProperty('--accent-cyan', selected.primary);
  root.style.setProperty('--accent-blue', selected.secondary);
  root.style.setProperty('--accent-glow', selected.glow);
  root.style.setProperty('--accent-badge-bg', selected.badgeBg);

  return selected.id;
}
