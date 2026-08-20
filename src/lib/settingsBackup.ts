/**
 * Settings Backup & Restore utilities.
 *
 * Modeled after the preset sharing pattern from CursorFX Studio: settings are
 * exported to a portable JSON file and re-imported through a strict sanitizer
 * that rejects unknown fields and coerces wrong-typed values back to the
 * caller-provided fallback — a corrupted or hand-edited backup can never
 * crash the settings engine.
 */

import type { AppSettings, GlobalHotkeyAction, GlobalHotkeyBinding } from '../bindings';
import { DEFAULT_THEME_ACCENT, THEME_PRESETS } from './theme';
import { APP_SLUG } from './appMeta';
import { downloadTextFile } from './download';

export const SETTINGS_BACKUP_MIME = 'application/json';

/** Rust `i32::MIN` — the backend's sentinel for "no saved window position". */
const UNSET_WINDOW_POSITION = -2147483648;

/**
 * The version a document carries when it predates schema versioning.
 *
 * Mirrors the `#[serde(default)]` on `AppSettings::settings_version` in
 * `src-tauri/src/lib.rs`, which is `0` for the same reason: "no version
 * recorded" and "version 0" are the same statement.
 */
const UNVERSIONED = 0;

/**
 * Factory defaults used when the import fallback itself is unavailable.
 * Typed `Required<AppSettings>` so every field is guaranteed present — this is
 * the terminal fallback the sanitizer resolves to.
 */
export const FALLBACK_SETTINGS: Required<AppSettings> = {
  // Deliberately the legacy value, not the current schema version. This
  // constant is the fallback for an *imported document of unknown provenance*,
  // and claiming such a document is current would make the backend skip
  // migrations it may genuinely need. See `sanitizeSettings`.
  settings_version: UNVERSIONED,
  minimize_to_tray: false,
  start_minimized: false,
  check_updates_on_launch: true,
  theme_accent: DEFAULT_THEME_ACCENT,
  remember_window_size: false,
  remember_window_position: false,
  saved_window_width: 0,
  saved_window_height: 0,
  saved_window_x: UNSET_WINDOW_POSITION,
  saved_window_y: UNSET_WINDOW_POSITION,
  autostart_enabled: false,
  global_hotkeys_enabled: false,
  global_hotkeys: [],
};

/**
 * Actions a global hotkey may be bound to. Mirrors `GlobalHotkeyAction` in
 * `src-tauri/src/global_hotkeys.rs` — an imported backup naming anything else
 * is rejected rather than passed through to the backend.
 */
const GLOBAL_HOTKEY_ACTIONS: ReadonlySet<GlobalHotkeyAction> = new Set([
  'toggle_window',
  'show_window',
  'check_updates',
]);

/**
 * Validates the global hotkey list from an untrusted backup.
 *
 * Entries with an unknown action, a non-string spec, or a duplicate action are
 * dropped. The specs themselves are *not* parsed here — the Rust side owns the
 * hotkey grammar and re-validates every spec when it registers them, and it
 * already ignores individual unparseable bindings.
 */
function sanitizeGlobalHotkeys(
  value: unknown,
  fallback: GlobalHotkeyBinding[]
): GlobalHotkeyBinding[] {
  if (!Array.isArray(value)) return [...fallback];

  const seen = new Set<GlobalHotkeyAction>();
  const result: GlobalHotkeyBinding[] = [];

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { action, spec } = entry as { action?: unknown; spec?: unknown };
    if (typeof action !== 'string' || typeof spec !== 'string') continue;
    if (!GLOBAL_HOTKEY_ACTIONS.has(action as GlobalHotkeyAction)) continue;
    if (seen.has(action as GlobalHotkeyAction)) continue;

    seen.add(action as GlobalHotkeyAction);
    result.push({ action: action as GlobalHotkeyAction, spec: spec.trim() });
  }

  return result;
}

/**
 * Validates an unknown JSON payload into a safe `AppSettings`.
 *
 * Every field is individually type-checked: booleans must be booleans,
 * the accent must be a known preset id, and unknown fields are dropped
 * entirely. Invalid or absent fields fall back to the supplied fallback
 * (normally the currently persisted settings).
 */
export function sanitizeSettings(input: unknown, fallback: AppSettings): Required<AppSettings> {
  // Resolve the caller's fallback against the factory defaults first: callers
  // pass structs straight from the backend, where every field but one is
  // optional, so a missing field must never leak `undefined` into the result.
  const base: Required<AppSettings> = {
    settings_version: fallback.settings_version ?? FALLBACK_SETTINGS.settings_version,
    minimize_to_tray: fallback.minimize_to_tray ?? FALLBACK_SETTINGS.minimize_to_tray,
    start_minimized: fallback.start_minimized ?? FALLBACK_SETTINGS.start_minimized,
    check_updates_on_launch:
      fallback.check_updates_on_launch ?? FALLBACK_SETTINGS.check_updates_on_launch,
    theme_accent: fallback.theme_accent ?? FALLBACK_SETTINGS.theme_accent,
    autostart_enabled: fallback.autostart_enabled ?? FALLBACK_SETTINGS.autostart_enabled,
    remember_window_size: fallback.remember_window_size ?? FALLBACK_SETTINGS.remember_window_size,
    remember_window_position:
      fallback.remember_window_position ?? FALLBACK_SETTINGS.remember_window_position,
    saved_window_width: fallback.saved_window_width ?? FALLBACK_SETTINGS.saved_window_width,
    saved_window_height: fallback.saved_window_height ?? FALLBACK_SETTINGS.saved_window_height,
    saved_window_x: fallback.saved_window_x ?? FALLBACK_SETTINGS.saved_window_x,
    saved_window_y: fallback.saved_window_y ?? FALLBACK_SETTINGS.saved_window_y,
    global_hotkeys_enabled:
      fallback.global_hotkeys_enabled ?? FALLBACK_SETTINGS.global_hotkeys_enabled,
    global_hotkeys: fallback.global_hotkeys ?? FALLBACK_SETTINGS.global_hotkeys,
  };

  // Arrays are `typeof 'object'` too, and a JSON array is never valid settings.
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return base;
  const raw = input as Record<string, unknown>;

  const bool = (key: keyof AppSettings, fallbackValue: boolean): boolean =>
    typeof raw[key] === 'boolean' ? raw[key] : fallbackValue;

  /**
   * Window geometry must be a whole number: the Rust side deserializes these as
   * `u32`/`i32`, and a fractional value from a hand-edited backup would be
   * rejected by serde at the IPC boundary. `min` additionally rejects negative
   * sizes (positions may legitimately be negative on a left-of-primary monitor).
   */
  const int = (
    key: keyof AppSettings,
    fallbackValue: number,
    min = Number.NEGATIVE_INFINITY
  ): number => {
    const value = raw[key];
    return typeof value === 'number' && Number.isInteger(value) && value >= min
      ? value
      : fallbackValue;
  };

  return {
    // Carried through from the backup rather than stamped to the current
    // schema, and the distinction matters.
    //
    // An imported file has the same unknown provenance as a `settings.json`
    // found on disk: it may have been exported by an older build. Overwriting
    // its version with "current" would tell the backend there is nothing to
    // migrate, and every future migration step would then be skipped for
    // exactly the documents that need it most. Preserving it means the file is
    // written back as-is and the migration ladder in
    // `src-tauri/src/settings_migrate.rs` picks it up on the next launch — the
    // same path a legacy file on disk takes.
    //
    // A missing or unusable value becomes `UNVERSIONED`, which is the
    // conservative reading: re-running an idempotent migration costs nothing,
    // skipping a needed one leaves a broken document.
    settings_version:
      typeof raw.settings_version === 'number' &&
      Number.isInteger(raw.settings_version) &&
      raw.settings_version >= 0
        ? raw.settings_version
        : UNVERSIONED,
    minimize_to_tray: bool('minimize_to_tray', base.minimize_to_tray),
    start_minimized: bool('start_minimized', base.start_minimized),
    check_updates_on_launch: bool('check_updates_on_launch', base.check_updates_on_launch),
    theme_accent:
      typeof raw.theme_accent === 'string' && THEME_PRESETS.some((p) => p.id === raw.theme_accent)
        ? raw.theme_accent
        : base.theme_accent,
    // Importing a backup can therefore ask the app to start at OS login. That
    // is intentional and matches every other preference, but it is a
    // security-relevant one, so it goes through the same strict boolean check
    // and — crucially — the backend still refuses to write the OS entry from a
    // development build (`src-tauri/src/autostart.rs`).
    autostart_enabled: bool('autostart_enabled', base.autostart_enabled),
    remember_window_size: bool('remember_window_size', base.remember_window_size),
    remember_window_position: bool('remember_window_position', base.remember_window_position),
    saved_window_width: int('saved_window_width', base.saved_window_width, 0),
    saved_window_height: int('saved_window_height', base.saved_window_height, 0),
    saved_window_x: int('saved_window_x', base.saved_window_x),
    saved_window_y: int('saved_window_y', base.saved_window_y),
    global_hotkeys_enabled: bool('global_hotkeys_enabled', base.global_hotkeys_enabled),
    global_hotkeys: sanitizeGlobalHotkeys(raw.global_hotkeys, base.global_hotkeys),
  };
}

/** Serializes settings to pretty-printed JSON for backup export. */
export function serializeSettings(settings: AppSettings): string {
  return JSON.stringify(settings, null, 2);
}

/** Triggers a browser download of the settings as a versioned `.json` file. */
export function downloadSettingsFile(settings: AppSettings, version: string): void {
  downloadTextFile(
    `${APP_SLUG}-settings-${version}.json`,
    serializeSettings(settings),
    `${SETTINGS_BACKUP_MIME};charset=utf-8`
  );
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
