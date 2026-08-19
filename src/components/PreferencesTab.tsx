import { createSignal, onSettled } from 'solid-js';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { commands } from '../bindings';
import type { AppSettings as BindingAppSettings } from '../bindings';
import { Power, Minimize2, Maximize2, Move3d, Palette, EyeOff, RefreshCw } from '../lib/icons';
import { ToggleSwitch } from './ToggleSwitch';
import { UpdateChecker } from './UpdateChecker';
import { GlobalHotkeysSection } from './GlobalHotkeysSection';
import {
  THEME_PRESETS,
  THEME_ACCENT_STORAGE_KEY,
  applyThemeAccent,
  type ThemeAccent,
  DEFAULT_THEME_ACCENT,
} from '../lib/theme';
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
  const [autostart, setAutostart] = createSignal<boolean>(false);
  const [minimizeToTray, setMinimizeToTray] = createSignal<boolean>(false);
  const [startMinimized, setStartMinimized] = createSignal<boolean>(false);
  const [checkUpdatesOnLaunch, setCheckUpdatesOnLaunch] = createSignal<boolean>(true);
  const [rememberWindowSize, setRememberWindowSize] = createSignal<boolean>(false);
  const [rememberWindowPosition, setRememberWindowPosition] = createSignal<boolean>(false);
  const [currentAccent, setCurrentAccent] = createSignal<ThemeAccent>(DEFAULT_THEME_ACCENT);
  /**
   * Gates the update checker's auto-check until the persisted preferences have
   * actually been read. Without it, `checkUpdatesOnLaunch` sits at its optimistic
   * `true` default for the duration of the settings IPC round-trip and the
   * checker fires a launch check even when the user has the setting turned off.
   */
  const [settingsLoaded, setSettingsLoaded] = createSignal<boolean>(false);

  // Load persisted preferences on mount (one-time, not reactive).
  onSettled(() => {
    if (!isTauri) {
      const saved = localStorage.getItem(THEME_ACCENT_STORAGE_KEY) as ThemeAccent | null;
      if (saved) {
        const accent = applyThemeAccent(saved);
        setCurrentAccent(accent);
      }
      setSettingsLoaded(true);
      return;
    }

    let isCancelled = false;
    Promise.all([
      isEnabled().catch((err: unknown) => {
        console.warn('Autostart check failed:', err);
        return false;
      }),
      loadSettingsWithRetry(0),
    ]).then(([autostartEnabled, settings]) => {
      if (isCancelled) return;
      setAutostart(autostartEnabled);
      if (settings) {
        // Every AppSettings field is optional: the Rust struct gives each one a
        // serde default so an older/newer settings.json still loads, which makes
        // them all optional in the generated bindings.
        setMinimizeToTray(settings.minimize_to_tray ?? false);
        setStartMinimized(settings.start_minimized ?? false);
        setCheckUpdatesOnLaunch(settings.check_updates_on_launch ?? true);
        setRememberWindowSize(settings.remember_window_size ?? false);
        setRememberWindowPosition(settings.remember_window_position ?? false);
        const applied = applyThemeAccent(settings.theme_accent);
        setCurrentAccent(applied);

        // Self-heal: write corrected accent back to disk if the persisted value
        // was invalid (e.g. hand-edited JSON or a renamed preset).
        if (applied !== settings.theme_accent) {
          void commands.updateAppSettings({ ...settings, theme_accent: applied });
        }
      }
      setSettingsLoaded(true);
    });

    return () => {
      isCancelled = true;
    };
  });

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

    if (isTauri) {
      try {
        if (newValue) {
          await enable();
          toast.success('Autostart on OS launch enabled');
          props.onStatusChange('Autostart enabled for OS startup');
        } else {
          await disable();
          toast.info('Autostart disabled');
          props.onStatusChange('Autostart disabled');
        }
      } catch (error: unknown) {
        console.error('Failed to toggle autostart:', error);
        setAutostart(!newValue);
        toast.error('Failed to update autostart setting');
        props.onStatusChange('Error setting autostart');
      }
    } else {
      toast.info(`[Web Preview] Autostart set to ${newValue}`);
      props.onStatusChange(`[Web Preview] Autostart set to ${newValue}`);
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
    const active = applyThemeAccent(accent);
    setCurrentAccent(active);

    if (isTauri) {
      try {
        await saveSettings({ theme_accent: accent });
        const preset = THEME_PRESETS.find((p) => p.id === accent);
        toast.success(`Accent changed to ${preset?.name ?? accent}`);
      } catch (err: unknown) {
        console.error('Failed to persist theme accent:', err);
      }
    } else {
      localStorage.setItem(THEME_ACCENT_STORAGE_KEY, accent);
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

      {/* Auto-Update Checker Card */}
      <UpdateChecker
        onStatusChange={props.onStatusChange}
        variant="card"
        autoCheckOnMount={() => settingsLoaded() && checkUpdatesOnLaunch()}
        listenForEvents={() => true}
      />
    </div>
  );
}
