import { describe, expect, test } from 'bun:test';
import { sanitizeSettings, FALLBACK_SETTINGS, serializeSettings } from '../src/lib/settingsBackup';

const valid = {
  minimize_to_tray: true,
  start_minimized: false,
  check_updates_on_launch: true,
  theme_accent: 'emerald',
  remember_window_size: true,
  remember_window_position: true,
  saved_window_width: 1280,
  saved_window_height: 720,
  saved_window_x: 50,
  saved_window_y: 75,
};

describe('Settings Backup Sanitizer', () => {
  test('passes a valid payload through unchanged', () => {
    expect(sanitizeSettings(valid, FALLBACK_SETTINGS)).toEqual(valid);
  });

  test('drops unknown fields and preserves known ones', () => {
    const result = sanitizeSettings(
      { ...valid, evil_payload: 'rm -rf', nested: { x: 1 } },
      FALLBACK_SETTINGS
    );
    expect(result).toEqual(valid);
    expect('evil_payload' in result).toBe(false);
  });

  test('falls back per-field when types are wrong', () => {
    const result = sanitizeSettings(
      {
        minimize_to_tray: 'yes',
        start_minimized: 1,
        check_updates_on_launch: null,
        theme_accent: 42,
      },
      FALLBACK_SETTINGS
    );
    expect(result).toEqual(FALLBACK_SETTINGS);
  });

  test('falls back on corrupted window-geometry values', () => {
    const result = sanitizeSettings(
      {
        ...valid,
        saved_window_width: '1100px',
        saved_window_height: -5,
        saved_window_x: null,
      },
      FALLBACK_SETTINGS
    );
    expect(result.saved_window_width).toBe(FALLBACK_SETTINGS.saved_window_width);
    expect(result.saved_window_height).toBe(FALLBACK_SETTINGS.saved_window_height);
    expect(result.saved_window_x).toBe(FALLBACK_SETTINGS.saved_window_x);
    // Valid fields are still preserved.
    expect(result.saved_window_y).toBe(valid.saved_window_y);
    expect(result.minimize_to_tray).toBe(valid.minimize_to_tray);
  });

  test('rejects unknown accent ids and falls back to the fallback accent', () => {
    const fallback = { ...FALLBACK_SETTINGS, theme_accent: 'violet' };
    const result = sanitizeSettings({ ...valid, theme_accent: 'neon-x' }, fallback);
    expect(result.theme_accent).toBe('violet');
  });

  test('returns the fallback for null, undefined, arrays, and primitives', () => {
    for (const bad of [null, undefined, 'text', 42, [1, 2, 3]]) {
      expect(sanitizeSettings(bad, FALLBACK_SETTINGS)).toEqual(FALLBACK_SETTINGS);
    }
  });

  test('never mutates the fallback object', () => {
    const fallback = { ...FALLBACK_SETTINGS };
    sanitizeSettings({ ...valid, minimize_to_tray: true }, fallback);
    expect(fallback).toEqual(FALLBACK_SETTINGS);
  });

  test('serializeSettings round-trips through the sanitizer', () => {
    const json = serializeSettings(valid);
    const parsed = JSON.parse(json) as unknown;
    expect(sanitizeSettings(parsed, FALLBACK_SETTINGS)).toEqual(valid);
  });
});
