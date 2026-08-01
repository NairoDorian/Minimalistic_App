import { useState, useEffect, useCallback } from "react";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { invoke } from "@tauri-apps/api/core";
import { Power, Minimize2 } from "lucide-react";
import { ToggleSwitch } from "./ToggleSwitch";
import { UpdateChecker } from "./UpdateChecker";
import { isTauri } from "../lib/tauri";

interface PreferencesTabProps {
  /** Callback for the shared footer status message (auto-cleared by App.tsx). */
  onStatusChange: (status: string) => void;
}

/**
 * Preferences tab panel.
 *
 * Owns the two persisted preference toggles (OS autostart via the Tauri
 * autostart plugin, minimize-to-tray via Rust IPC) plus the embedded
 * auto-update checker card. Both toggles apply optimistic UI updates and
 * roll back if the native call fails — matching the Rust backend's
 * `Result<(), String>` error contract (see `set_minimize_to_tray`).
 */
export function PreferencesTab({ onStatusChange }: PreferencesTabProps) {
  const [autostart, setAutostart] = useState<boolean>(false);
  const [minimizeToTray, setMinimizeToTray] = useState<boolean>(false);

  // Load both persisted preferences asynchronously in parallel. Failures fall
  // back to the default (off) state; StrictMode dev double-mounting is harmless
  // because the IPC reads are idempotent.
  useEffect(() => {
    if (!isTauri) return;

    Promise.all([
      isEnabled().catch((err: unknown) => {
        console.warn("Autostart check failed:", err);
        return false;
      }),
      invoke<boolean>("get_minimize_to_tray").catch((err: unknown) => {
        console.warn("Minimize to tray check failed:", err);
        return false;
      }),
    ]).then(([autostartEnabled, minimizeEnabled]) => {
      setAutostart(autostartEnabled);
      setMinimizeToTray(minimizeEnabled);
    });
  }, []);

  /**
   * Toggles OS Startup setting via Tauri autostart plugin.
   * Optimistic UI update is rolled back if the native plugin call fails.
   */
  const handleAutostartToggle = useCallback(
    async (newValue: boolean) => {
      setAutostart(newValue);

      if (isTauri) {
        try {
          if (newValue) {
            await enable();
            onStatusChange("Autostart enabled for OS startup");
          } else {
            await disable();
            onStatusChange("Autostart disabled");
          }
        } catch (error: unknown) {
          console.error("Failed to toggle autostart:", error);
          setAutostart(!newValue);
          onStatusChange("Error setting autostart");
        }
      } else {
        onStatusChange(`[Web Preview] Autostart set to ${newValue}`);
      }
    },
    [onStatusChange]
  );

  /**
   * Toggles Minimize to System Tray setting via Rust IPC invoke command.
   * Optimistic UI update is rolled back if the IPC call fails.
   */
  const handleMinimizeToTrayToggle = useCallback(
    async (newValue: boolean) => {
      setMinimizeToTray(newValue);

      if (isTauri) {
        try {
          await invoke("set_minimize_to_tray", { enabled: newValue });
          onStatusChange(
            newValue
              ? "Minimize to tray on close enabled (Saved)"
              : "Quit on window close enabled (Saved)"
          );
        } catch (error: unknown) {
          console.error("Failed to update minimize to tray preference:", error);
          setMinimizeToTray(!newValue);
          onStatusChange("Error saving tray preference");
        }
      } else {
        onStatusChange(`[Web Preview] Minimize to tray set to ${newValue}`);
      }
    },
    [onStatusChange]
  );

  return (
    <div
      className="settings-card"
      id="panel-preferences"
      role="tabpanel"
      aria-labelledby="tab-preferences"
    >
      <div className="settings-card-header">
        <h2 className="settings-card-title">Application Settings</h2>
        <p className="settings-card-desc">
          Configure taskbar system tray behavior, OS startup preferences, and software updates.
        </p>
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

      {/* Section 3: Auto-Update Checker (primary instance: listens for tray events) */}
      <UpdateChecker onStatusChange={onStatusChange} variant="card" />
    </div>
  );
}
