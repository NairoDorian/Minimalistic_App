import { useState, useEffect, useCallback } from 'react';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { invoke } from '@tauri-apps/api/core';
import { Power, Minimize2, Palette, EyeOff } from 'lucide-react';
import { ToggleSwitch } from './ToggleSwitch';
import { UpdateChecker } from './UpdateChecker';
import {
  THEME_PRESETS,
  applyThemeAccent,
  type ThemeAccent,
  DEFAULT_THEME_ACCENT,
} from '../lib/theme';
import { toast } from '../lib/toast';
import { isTauri } from '../lib/tauri';

export interface AppSettingsDto {
  minimize_to_tray: boolean;
  start_minimized: boolean;
  check_updates_on_launch: boolean;
  theme_accent: string;
}

interface PreferencesTabProps {
  onStatusChange: (status: string) => void;
  onAccentChange?: (accent: ThemeAccent) => void;
}

export function PreferencesTab({ onStatusChange, onAccentChange }: PreferencesTabProps) {
  const [autostart, setAutostart] = useState<boolean>(false);
  const [minimizeToTray, setMinimizeToTray] = useState<boolean>(false);
  const [startMinimized, setStartMinimized] = useState<boolean>(false);
  const [currentAccent, setCurrentAccent] = useState<ThemeAccent>(DEFAULT_THEME_ACCENT);

  // Load persisted preferences
  useEffect(() => {
    let isMounted = true;

    if (isTauri) {
      Promise.all([
        isEnabled().catch((err: unknown) => {
          console.warn('Autostart check failed:', err);
          return false;
        }),
        invoke<AppSettingsDto>('get_app_settings').catch((err: unknown) => {
          console.warn('Get app settings failed:', err);
          return null;
        }),
      ]).then(([autostartEnabled, settings]) => {
        if (!isMounted) return;
        setAutostart(autostartEnabled);
        if (settings) {
          setMinimizeToTray(settings.minimize_to_tray);
          setStartMinimized(settings.start_minimized);
          const accent = applyThemeAccent(settings.theme_accent);
          setCurrentAccent(accent);
          onAccentChange?.(accent);
        }
      });
    } else {
      const saved = localStorage.getItem('theme_accent') as ThemeAccent | null;
      if (saved) {
        const accent = applyThemeAccent(saved);
        setCurrentAccent(accent);
        onAccentChange?.(accent);
      }
    }

    return () => {
      isMounted = false;
    };
  }, [onAccentChange]);

  const handleAutostartToggle = useCallback(
    async (newValue: boolean) => {
      setAutostart(newValue);

      if (isTauri) {
        try {
          if (newValue) {
            await enable();
            toast.success('Autostart on OS launch enabled');
            onStatusChange('Autostart enabled for OS startup');
          } else {
            await disable();
            toast.info('Autostart disabled');
            onStatusChange('Autostart disabled');
          }
        } catch (error: unknown) {
          console.error('Failed to toggle autostart:', error);
          setAutostart(!newValue);
          toast.error('Failed to update autostart setting');
          onStatusChange('Error setting autostart');
        }
      } else {
        toast.info(`[Web Preview] Autostart set to ${newValue}`);
        onStatusChange(`[Web Preview] Autostart set to ${newValue}`);
      }
    },
    [onStatusChange]
  );

  const handleMinimizeToTrayToggle = useCallback(
    async (newValue: boolean) => {
      setMinimizeToTray(newValue);

      if (isTauri) {
        try {
          await invoke('set_minimize_to_tray', { enabled: newValue });
          toast.success(newValue ? 'Minimize to tray on close enabled' : 'Quit on close enabled');
          onStatusChange(
            newValue
              ? 'Minimize to tray on close enabled (Saved)'
              : 'Quit on window close enabled (Saved)'
          );
        } catch (error: unknown) {
          console.error('Failed to update minimize to tray preference:', error);
          setMinimizeToTray(!newValue);
          toast.error('Failed to save tray preference');
          onStatusChange('Error saving tray preference');
        }
      } else {
        toast.info(`[Web Preview] Minimize to tray set to ${newValue}`);
        onStatusChange(`[Web Preview] Minimize to tray set to ${newValue}`);
      }
    },
    [onStatusChange]
  );

  const handleStartMinimizedToggle = useCallback(
    async (newValue: boolean) => {
      setStartMinimized(newValue);

      if (isTauri) {
        try {
          await invoke('update_app_settings', {
            settings: {
              minimize_to_tray: minimizeToTray,
              start_minimized: newValue,
              check_updates_on_launch: true,
              theme_accent: currentAccent,
            },
          });
          toast.success(newValue ? 'App will start minimized to tray' : 'App will start visible');
          onStatusChange(newValue ? 'Start minimized enabled' : 'Start minimized disabled');
        } catch (error: unknown) {
          console.error('Failed to update start minimized preference:', error);
          setStartMinimized(!newValue);
          toast.error('Failed to save setting');
        }
      } else {
        toast.info(`[Web Preview] Start minimized set to ${newValue}`);
      }
    },
    [minimizeToTray, currentAccent, onStatusChange]
  );

  const handleAccentChange = useCallback(
    async (accent: ThemeAccent) => {
      const active = applyThemeAccent(accent);
      setCurrentAccent(active);
      onAccentChange?.(active);

      if (isTauri) {
        try {
          await invoke('update_app_settings', {
            settings: {
              minimize_to_tray: minimizeToTray,
              start_minimized: startMinimized,
              check_updates_on_launch: true,
              theme_accent: accent,
            },
          });
          toast.success(`Accent changed to ${THEME_PRESETS.find((p) => p.id === accent)?.name}`);
        } catch (err: unknown) {
          console.error('Failed to persist theme accent:', err);
        }
      } else {
        localStorage.setItem('theme_accent', accent);
        toast.success(`[Web Preview] Accent set to ${accent}`);
      }
    },
    [minimizeToTray, startMinimized, onAccentChange]
  );

  return (
    <div
      className="settings-card"
      id="panel-preferences"
      role="tabpanel"
      tabIndex={0}
      aria-labelledby="tab-preferences"
    >
      <div className="settings-card-header">
        <h2 className="settings-card-title">Application Settings</h2>
        <p className="settings-card-desc">
          Configure taskbar system tray behavior, theme accent personalization, and software
          updates.
        </p>
      </div>

      {/* Theme Accent Customization */}
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-icon">
            <Palette size={18} />
          </div>
          <div className="setting-text">
            <span className="setting-title">Theme Accent Color</span>
            <span className="setting-subtitle">
              Choose a neon accent palette for glass highlights, badges, and focus rings.
            </span>
          </div>
        </div>

        <div className="theme-swatch-list" role="radiogroup" aria-label="Theme Accent Color">
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`theme-swatch-btn ${currentAccent === preset.id ? 'selected' : ''}`}
              style={{ '--swatch-color': preset.primary } as React.CSSProperties}
              onClick={() => handleAccentChange(preset.id)}
              role="radio"
              aria-checked={currentAccent === preset.id}
              aria-label={preset.name}
              title={preset.name}
            >
              <span className="swatch-dot" />
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

      {/* Auto-Update Checker Card */}
      <UpdateChecker onStatusChange={onStatusChange} variant="card" />
    </div>
  );
}
