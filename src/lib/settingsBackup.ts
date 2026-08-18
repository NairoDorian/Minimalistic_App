/**
 * Settings Backup & Restore utilities.
 *
 * Modeled after the preset sharing pattern from CursorFX Studio: settings are
 * exported to a portable JSON file and re-imported through a strict sanitizer
 * that rejects unknown fields and coerces wrong-typed values back to the
 * caller-provided fallback — a corrupted or hand-edited backup can never
 * crash the settings engine.
 */

import type { AppSettings } from '../components/PreferencesTab';
import { THEME_PRESETS } from './theme';

export const SETTINGS_BACKUP_MIME = 'application/json';

/** Rust `i32::MIN` — the backend's sentinel for "no saved window position". */
const UNSET_WINDOW_POSITION = -2147483648;

/** Factory defaults used when the import fallback itself is unavailable. */
export const FALLBACK_SETTINGS: AppSettings = {
  minimize_to_tray: false,
  start_minimized: false,
  check_updates_on_launch: true,
  theme_accent: 'cyan',
  remember_window_size: false,
  remember_window_position: false,
  saved_window_width: 0,
  saved_window_height: 0,
  saved_window_x: UNSET_WINDOW_POSITION,
  saved_window_y: UNSET_WINDOW_POSITION,
};

/**
 * Validates an unknown JSON payload into a safe `AppSettings`.
 *
 * Every field is individually type-checked: booleans must be booleans,
 * the accent must be a known preset id, and unknown fields are dropped
 * entirely. Invalid or absent fields fall back to the supplied fallback
 * (normally the currently persisted settings).
 */
export function sanitizeSettings(input: unknown, fallback: AppSettings): AppSettings {
  if (typeof input !== 'object' || input === null) return { ...fallback };
  const raw = input as Record<string, unknown>;

  const num = (key: string): number => {
    const v = raw[key];
    return typeof v === 'number' && Number.isFinite(v)
      ? v
      : (fallback[key as keyof AppSettings] as number);
  };

  return {
    minimize_to_tray:
      typeof raw.minimize_to_tray === 'boolean' ? raw.minimize_to_tray : fallback.minimize_to_tray,
    start_minimized:
      typeof raw.start_minimized === 'boolean'
        ? raw.start_minimized
        : (fallback.start_minimized ?? false),
    check_updates_on_launch:
      typeof raw.check_updates_on_launch === 'boolean'
        ? raw.check_updates_on_launch
        : (fallback.check_updates_on_launch ?? true),
    theme_accent:
      typeof raw.theme_accent === 'string' && THEME_PRESETS.some((p) => p.id === raw.theme_accent)
        ? raw.theme_accent
        : (fallback.theme_accent ?? 'cyan'),
    remember_window_size:
      typeof raw.remember_window_size === 'boolean'
        ? raw.remember_window_size
        : (fallback.remember_window_size ?? false),
    remember_window_position:
      typeof raw.remember_window_position === 'boolean'
        ? raw.remember_window_position
        : (fallback.remember_window_position ?? false),
    saved_window_width:
      num('saved_window_width') >= 0
        ? num('saved_window_width')
        : (fallback.saved_window_width ?? 0),
    saved_window_height:
      num('saved_window_height') >= 0
        ? num('saved_window_height')
        : (fallback.saved_window_height ?? 0),
    saved_window_x: num('saved_window_x'),
    saved_window_y: num('saved_window_y'),
  };
}

/** Serializes settings to pretty-printed JSON for backup export. */
export function serializeSettings(settings: AppSettings): string {
  return JSON.stringify(settings, null, 2);
}

/** Triggers a browser download of the settings as a versioned `.json` file. */
export function downloadSettingsFile(settings: AppSettings, version: string): void {
  const blob = new Blob([serializeSettings(settings)], {
    type: `${SETTINGS_BACKUP_MIME};charset=utf-8`,
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `minimalistic-app-settings-${version}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Reads a selected backup file and parses it to an unknown payload for the
 * sanitizer. Rejects with a descriptive error when the file is not valid JSON.
 */
export function readSettingsFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      'load',
      () => {
        try {
          resolve(JSON.parse(String(reader.result ?? '{}')) as unknown);
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Backup file is not valid JSON'));
        }
      },
      { once: true }
    );
    reader.addEventListener(
      'error',
      () => reject(reader.error ?? new Error('Failed to read backup file')),
      { once: true }
    );
    reader.readAsText(file);
  });
}
