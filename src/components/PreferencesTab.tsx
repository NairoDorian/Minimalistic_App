import { createSignal, createEffect, createMemo, Loading, Show } from 'solid-js';
import { commands } from '../bindings';
import type { AppSettings as BindingAppSettings, AutostartStatus } from '../bindings';
import { Power, Minimize2, Maximize2, Move3d, Palette, EyeOff, RefreshCw } from '../lib/icons';
import { ToggleSwitch } from './ToggleSwitch';
import { UpdateChecker } from './UpdateChecker';
import { GlobalHotkeysSection } from './GlobalHotkeysSection';
import {
  THEME_PRESETS,
  THEME_ACCENT_STORAGE_KEY,
  applyThemeAccent,
  resolveThemeAccent,
  type ThemeAccent,
} from '../lib/theme';
import { FALLBACK_SETTINGS } from '../lib/settingsBackup';
import { readStored, writeStored } from '../lib/storage';
import { toast } from '../lib/toast';
import { isTauri } from '../lib/tauri';

/**
 * Type-safe settings type from the Tauri Specta generated bindings.
 * Re-exported here for consumers (DeveloperTab, settingsBackup) that
 * depend on the same shape without importing the bindings directly.
 */
export type AppSettings = BindingAppSettings;

interface PreferencesTabProps {
  onStatusChange: (status: string) => void;
}

/**
 * Everything this panel needs from persistence, resolved by one async read.
 *
 * Kept as a single value so the whole panel derives from one settled result
 * rather than from seven signals that populate at slightly different moments.
 */
interface PersistedPreferences {
  /**
   * The stored "start at OS login" preference, plus whether the OS entry is
   * actually registered and whether this build refuses to write it.
   *
   * Autostart is deliberately NOT driven through `@tauri-apps/plugin-autostart`
   * from here. That plugin registers the path of the *running* executable, so a
   * click during `tauri dev` would point the OS at `src-tauri/target/debug` and
   * overwrite the installed app's launch entry. The backend owns the write and
   * skips it in a development build — see `src-tauri/src/autostart.rs`.
   */
  autostart: AutostartStatus;
  /** The persisted settings struct, or factory defaults when it cannot be read. */
  settings: AppSettings;
  /** The accent that will be applied — falls back when the stored id is unknown. */
  accent: ThemeAccent;
}

/** Loads persisted settings with exponential backoff retries (up to 3 attempts). */
const loadSettingsWithRetry = async (attempt: number): Promise<AppSettings | null> => {
  try {
    return await commands.getAppSettings();
  } catch (err: unknown) {
    if (attempt >= 3) {
      console.warn('Get app settings failed after retries:', err);
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    return loadSettingsWithRetry(attempt + 1);
  }
};

export function PreferencesTab(props: PreferencesTabProps) {
  /**
   * Persisted preferences as a SolidJS 2 async memo — "async lives in the graph".
   *
   * This replaces a mount-time `.then()` that pushed its result into seven
   * separate signals. Doing it in the graph is not merely tidier: the settings
   * rows below sit inside a `<Loading>` boundary, so they are not rendered —
   * and therefore not clickable — until this read settles. Previously a toggle
   * clicked during the IPC round-trip was written to disk and then silently
   * reverted in the UI when the loader's `setX(settings.x)` landed on top of it.
   */
  const persisted = createMemo(async (): Promise<PersistedPreferences> => {
    if (!isTauri) {
      return {
        autostart: { enabled: false, os_registered: false, dev_build: false },
        settings: FALLBACK_SETTINGS,
        accent: resolveThemeAccent(readStored(THEME_ACCENT_STORAGE_KEY)),
      };
    }

    const [autostart, settings] = await Promise.all([
      commands.getAutostart().catch((err: unknown) => {
        console.warn('Autostart status query failed:', err);
        return { enabled: false, os_registered: false, dev_build: false } satisfies AutostartStatus;
      }),
      loadSettingsWithRetry(0),
    ]);

    // Every AppSettings field is optional: the Rust struct gives each one a
    // serde default so an older/newer settings.json still loads, which makes
    // them all optional in the generated bindings.
    const resolved = settings ?? FALLBACK_SETTINGS;
    return {
      autostart,
      settings: resolved,
      accent: resolveThemeAccent(resolved.theme_accent),
    };
  });

  /*
   * Writable derived signals (`createSignal(fn)`): the persisted value is the
   * source, and a toggle places a local override on top of it. This is the
   * documented shape for "starts from a reactive source but needs a local
   * value", and it removes the copy-async-result-into-a-signal step entirely.
   */
  const [autostart, setAutostart] = createSignal(() => persisted().autostart.enabled);
  /**
   * True when this build records the preference but deliberately does not write
   * the OS launch entry. Surfaced under the toggle so the switch is never
   * silently lying about what the operating system will do.
   */
  const isDevBuild = () => persisted().autostart.dev_build;
  const [minimizeToTray, setMinimizeToTray] = createSignal(
    () => persisted().settings.minimize_to_tray ?? false
  );
  const [startMinimized, setStartMinimized] = createSignal(
    () => persisted().settings.start_minimized ?? false
  );
  const [checkUpdatesOnLaunch, setCheckUpdatesOnLaunch] = createSignal(
    () => persisted().settings.check_updates_on_launch ?? true
  );
  const [rememberWindowSize, setRememberWindowSize] = createSignal(
    () => persisted().settings.remember_window_size ?? false
  );
  const [rememberWindowPosition, setRememberWindowPosition] = createSignal(
    () => persisted().settings.remember_window_position ?? false
  );
  const [currentAccent, setCurrentAccent] = createSignal(() => persisted().accent);

  // Imperative boundary: paint the accent onto the document's CSS custom
  // properties. Deliberately an effect rather than part of the memo, because a
  // memo compute must stay side-effect free.
  createEffect(
    () => currentAccent(),
    (accent) => {
      applyThemeAccent(accent);
    }
  );

  // One-shot self-heal: a persisted accent naming an unknown preset (hand-edited
  // JSON, a renamed preset) is corrected on disk. The compute phase reads the
  // async memo, so the apply phase runs only once that read has settled.
  createEffect(
    () => persisted(),
    (loaded) => {
      if (!isTauri) return;
      if (loaded.settings.theme_accent === loaded.accent) return;
      void commands.updateAppSettings({ ...loaded.settings, theme_accent: loaded.accent });
    }
  );

  /**
   * Persists the full settings struct, merging a partial patch over the current
   * preferences. Fetches a fresh copy from the backend immediately before writing
   * so backend-managed window-geometry fields (updated by save_window_geometry on
   * every move/resize) are carried through instead of being clobbered by a stale
   * mount-time snapshot. Every toggle writes the complete AppSettings struct so no
   * other preference is silently dropped.
   */
  const saveSettings = async (patch: Partial<AppSettings>) => {
    const current = await commands.getAppSettings();
    const next: AppSettings = {
      ...current,
      minimize_to_tray: minimizeToTray(),
      start_minimized: startMinimized(),
      check_updates_on_launch: checkUpdatesOnLaunch(),
      theme_accent: currentAccent(),
      remember_window_size: rememberWindowSize(),
      remember_window_position: rememberWindowPosition(),
      ...patch,
    };
    await commands.updateAppSettings(next);
  };

  const handleAutostartToggle = async (newValue: boolean) => {
    setAutostart(newValue);

    if (!isTauri) {
      toast.info(`[Web Preview] Autostart set to ${newValue}`);
      props.onStatusChange(`[Web Preview] Autostart set to ${newValue}`);
      return;
    }

    try {
      // The backend persists the preference first and only then touches the OS,
      // and it reports back whether the OS entry was actually written.
      const status = await commands.setAutostart(newValue);

      if (status.dev_build) {
        toast.warning('Preference saved — a dev build never writes the OS launch entry');
        props.onStatusChange('Autostart preference saved (dev build: OS entry untouched)');
      } else if (newValue) {
        toast.success('Autostart on OS launch enabled');
        props.onStatusChange('Autostart enabled for OS startup');
      } else {
        toast.info('Autostart disabled');
        props.onStatusChange('Autostart disabled');
      }
    } catch (error: unknown) {
      console.error('Failed to toggle autostart:', error);
      setAutostart(!newValue);
      toast.error('Failed to update autostart setting');
      props.onStatusChange('Error setting autostart');
    }
  };

  const handleMinimizeToTrayToggle = async (newValue: boolean) => {
    setMinimizeToTray(newValue);

    if (isTauri) {
      try {
        await commands.setMinimizeToTray(newValue);
        toast.success(newValue ? 'Minimize to tray on close enabled' : 'Quit on close enabled');
        props.onStatusChange(
          newValue
            ? 'Minimize to tray on close enabled (Saved)'
            : 'Quit on window close enabled (Saved)'
        );
      } catch (error: unknown) {
        console.error('Failed to update minimize to tray preference:', error);
        setMinimizeToTray(!newValue);
        toast.error('Failed to save tray preference');
        props.onStatusChange('Error saving tray preference');
      }
    } else {
      toast.info(`[Web Preview] Minimize to tray set to ${newValue}`);
      props.onStatusChange(`[Web Preview] Minimize to tray set to ${newValue}`);
    }
  };

  const handleStartMinimizedToggle = async (newValue: boolean) => {
    setStartMinimized(newValue);
    if (isTauri) {
      try {
        await saveSettings({ start_minimized: newValue });
        toast.success(newValue ? 'App will start minimized to tray' : 'App will start visible');
        props.onStatusChange(newValue ? 'Start minimized enabled' : 'Start minimized disabled');
      } catch (error: unknown) {
        console.error('Failed to update start minimized preference:', error);
        setStartMinimized(!newValue);
        toast.error('Failed to save setting');
      }
    } else {
      toast.info(`[Web Preview] Start minimized set to ${newValue}`);
    }
  };

  const handleCheckUpdatesToggle = async (newValue: boolean) => {
    setCheckUpdatesOnLaunch(newValue);

    if (isTauri) {
      try {
        await saveSettings({ check_updates_on_launch: newValue });
        toast.success(
          newValue ? 'Update checks on launch enabled' : 'Update checks on launch disabled'
        );
        props.onStatusChange(
          newValue ? 'Update checks on launch enabled' : 'Update checks on launch disabled'
        );
      } catch (error: unknown) {
        console.error('Failed to update update-check preference:', error);
        setCheckUpdatesOnLaunch(!newValue);
        toast.error('Failed to save update check setting');
        props.onStatusChange('Error saving update check setting');
      }
    } else {
      toast.info(`[Web Preview] Check updates on launch set to ${newValue}`);
      props.onStatusChange(`[Web Preview] Check updates on launch set to ${newValue}`);
    }
  };

  const handleRememberWindowSizeToggle = async (newValue: boolean) => {
    setRememberWindowSize(newValue);
    if (isTauri) {
      try {
        await saveSettings({ remember_window_size: newValue });
        toast.success(
          newValue ? 'Window size restored on next launch' : 'Window size no longer restored'
        );
        props.onStatusChange(
          newValue ? 'Remember window size enabled' : 'Remember window size disabled'
        );
      } catch (error: unknown) {
        console.error('Failed to update remember_window_size preference:', error);
        setRememberWindowSize(!newValue);
        toast.error('Failed to save window size preference');
        props.onStatusChange('Error saving window size preference');
      }
    } else {
      toast.info(`[Web Preview] Remember window size set to ${newValue}`);
    }
  };

  const handleRememberWindowPositionToggle = async (newValue: boolean) => {
    setRememberWindowPosition(newValue);
    if (isTauri) {
      try {
        await saveSettings({ remember_window_position: newValue });
        toast.success(
          newValue
            ? 'Window position restored on next launch'
            : 'Window position no longer restored'
        );
        props.onStatusChange(
          newValue ? 'Remember window position enabled' : 'Remember window position disabled'
        );
      } catch (error: unknown) {
        console.error('Failed to update remember_window_position preference:', error);
        setRememberWindowPosition(!newValue);
        toast.error('Failed to save window position preference');
        props.onStatusChange('Error saving window position preference');
      }
    } else {
      toast.info(`[Web Preview] Remember window position set to ${newValue}`);
    }
  };

  const handleAccentChange = async (accent: ThemeAccent) => {
    // Setting the signal is enough — the effect above paints it onto the DOM.
    setCurrentAccent(accent);

    if (isTauri) {
      try {
        await saveSettings({ theme_accent: accent });
        const preset = THEME_PRESETS.find((p) => p.id === accent);
        toast.success(`Accent changed to ${preset?.name ?? accent}`);
      } catch (err: unknown) {
        console.error('Failed to persist theme accent:', err);
      }
    } else {
      writeStored(THEME_ACCENT_STORAGE_KEY, accent);
      toast.success(`[Web Preview] Accent set to ${accent}`);
    }
  };

  return (
    <div
      class="settings-card"
      id="panel-preferences"
      role="tabpanel"
      tabindex={0}
      aria-labelledby="tab-preferences"
    >
      <div class="settings-card-header">
        <h2 class="settings-card-title">Application Settings</h2>
        <p class="settings-card-desc">
          Configure taskbar system tray behavior, theme accent personalization, and software
          updates.
        </p>
      </div>

      {/* Everything below derives from the `persisted` async memo, so it is
          scoped in its own boundary: the card header above stays put while the
          settings read is in flight, and no row is interactive until the real
          values are in hand. */}
      <Loading fallback={<PreferencesSkeleton />}>
        {/* Theme Accent Customization */}
        <div class="setting-item">
          <div class="setting-info">
            <div class="setting-icon">
              <Palette size={18} />
            </div>
            <div class="setting-text">
              <span class="setting-title">Theme Accent Color</span>
              <span class="setting-subtitle">
                Choose a neon accent palette for glass highlights, badges, and focus rings.
              </span>
            </div>
          </div>

          <div class="theme-swatch-list" role="radiogroup" aria-label="Theme Accent Color">
            {THEME_PRESETS.map((preset) => (
              <button
                type="button"
                class={`theme-swatch-btn ${currentAccent() === preset.id ? 'selected' : ''}`}
                style={{ '--swatch-color': preset.primary }}
                onClick={() => void handleAccentChange(preset.id)}
                role="radio"
                aria-checked={currentAccent() === preset.id ? 'true' : 'false'}
                aria-label={preset.name}
                title={preset.name}
              >
                <span class="swatch-dot" />
              </button>
            ))}
          </div>
        </div>

        {/* Toggle 1: Start at OS launch */}
        <ToggleSwitch
          icon={<Power size={18} />}
          title="Start at OS launch"
          subtitle="Automatically start this app silently in the system tray when your computer starts."
          checked={autostart}
          ariaLabel="Start at OS launch"
          onToggle={handleAutostartToggle}
        />

        {/* A development binary lives in target/debug, so registering it with the
            OS would replace the installed app's launch entry with a path into a
            build directory. The backend refuses; say so rather than letting the
            toggle imply something happened outside the app. */}
        <Show when={isDevBuild()}>
          <p class="setting-note" role="note">
            Development build — the preference is saved, but the OS launch entry is left untouched
            so it cannot overwrite the installed app's registration.
          </p>
        </Show>

        {/* Toggle 2: Minimize to taskbar on close */}
        <ToggleSwitch
          icon={<Minimize2 size={18} />}
          title="Minimize to taskbar on close"
          subtitle="Closing the window keeps the app running in the taskbar tray. State persists on disk."
          checked={minimizeToTray}
          ariaLabel="Minimize to taskbar on close"
          onToggle={handleMinimizeToTrayToggle}
        />

        {/* Toggle 3: Start Minimized */}
        <ToggleSwitch
          icon={<EyeOff size={18} />}
          title="Start silently minimized"
          subtitle="Launch directly into the background system tray without surfacing the main window."
          checked={startMinimized}
          ariaLabel="Start silently minimized"
          onToggle={handleStartMinimizedToggle}
        />

        {/* Toggle 4: Check for updates on launch */}
        <ToggleSwitch
          icon={<RefreshCw size={18} />}
          title="Check for updates on launch"
          subtitle="Automatically query GitHub Releases for a newer version when the app starts."
          checked={checkUpdatesOnLaunch}
          ariaLabel="Check for updates on launch"
          onToggle={handleCheckUpdatesToggle}
        />

        {/* Toggle 5: Remember window size */}
        <ToggleSwitch
          icon={<Maximize2 size={18} />}
          title="Remember window size"
          subtitle="Reopen the main window at the size you last used."
          checked={rememberWindowSize}
          ariaLabel="Remember window size"
          onToggle={handleRememberWindowSizeToggle}
        />

        {/* Toggle 6: Remember window position */}
        <ToggleSwitch
          icon={<Move3d size={18} />}
          title="Remember window position"
          subtitle="Reopen the main window where you last left it (guarded against off-screen placement)."
          checked={rememberWindowPosition}
          ariaLabel="Remember window position"
          onToggle={handleRememberWindowPositionToggle}
        />

        {/* System-wide hotkeys, handled by the native OS keyboard hook */}
        <GlobalHotkeysSection onStatusChange={props.onStatusChange} />

        {/* Auto-Update Checker Card. Mounted inside the boundary, so by the
            time it reads `checkUpdatesOnLaunch` the preference is the persisted
            one — the explicit "settings loaded yet?" gate this used to need is
            now structural. Event listening lives on the always-mounted footer
            instance in App.tsx, since this card unmounts when another tab is
            selected and a tray-triggered check must work from any tab. */}
        <UpdateChecker
          onStatusChange={props.onStatusChange}
          variant="card"
          autoCheckOnMount={checkUpdatesOnLaunch}
          listenForEvents={() => false}
        />
      </Loading>
    </div>
  );
}

/**
 * Fallback for the settings rows while the persisted preferences load.
 *
 * Mirrors the row rhythm rather than the whole card, so the header does not
 * move when the real rows swap in.
 */
function PreferencesSkeleton() {
  return (
    <div class="settings-skeleton" aria-busy="true" aria-live="polite">
      <span class="visually-hidden">Loading saved preferences…</span>
      <div class="settings-skeleton-row" />
      <div class="settings-skeleton-row" />
      <div class="settings-skeleton-row" />
    </div>
  );
}
