import { useState, useEffect, useCallback } from "react";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { invoke } from "@tauri-apps/api/core";
import { Settings, Power, Minimize2, Shield, AppWindow } from "lucide-react";
import { UpdateChecker } from "./components/UpdateChecker";
import { isTauri } from "./lib/tauri";

/**
 * Main Application Preferences GUI Component (React 19).
 * Provides a 1-tab minimalistic preferences interface for managing:
 * 1. OS Launch Autostart (Default: OFF)
 * 2. Minimize to Taskbar System Tray on Close (Default: ON)
 * 3. Auto-Updating & GitHub Release Management (Handy-inspired)
 */
export default function App() {
  // State tracking OS autostart preference
  const [autostart, setAutostart] = useState<boolean>(false);
  // State tracking minimize to tray preference
  const [minimizeToTray, setMinimizeToTray] = useState<boolean>(false);
  // Status message bar text
  const [statusMessage, setStatusMessage] = useState<string>("Ready");

  useEffect(() => {
    if (!isTauri) return;

    // Parallel IPC queries at mount — both preferences loaded simultaneously
    Promise.all([
      isEnabled().catch((err: unknown) => {
        console.warn("Autostart check failed:", err);
        return false;
      }),
      invoke<boolean>("get_minimize_to_tray").catch((err: unknown) => {
        console.warn("Minimize to tray check failed:", err);
        return true;
      }),
    ]).then(([autostartEnabled, minimizeEnabled]) => {
      setAutostart(autostartEnabled);
      setMinimizeToTray(minimizeEnabled);
    });
  }, []);

  /**
   * Toggles OS Startup setting via Tauri autostart plugin.
   */
  const handleAutostartToggle = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.checked;
      setAutostart(newValue);

      if (isTauri) {
        try {
          if (newValue) {
            await enable();
            setStatusMessage("Autostart enabled for OS startup");
          } else {
            await disable();
            setStatusMessage("Autostart disabled");
          }
        } catch (error: unknown) {
          console.error("Failed to toggle autostart:", error);
          setStatusMessage("Error setting autostart");
        }
      } else {
        setStatusMessage(`[Web Preview] Autostart set to ${newValue}`);
      }
    },
    [] // stable: isTauri is a module const; state setters are always stable references
  );

  /**
   * Toggles Minimize to System Tray setting via Rust IPC invoke command.
   */
  const handleMinimizeToTrayToggle = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.checked;
      setMinimizeToTray(newValue);

      if (isTauri) {
        try {
          await invoke("set_minimize_to_tray", { enabled: newValue });
          setStatusMessage(
            newValue
              ? "Minimize to tray on close enabled"
              : "Quit on window close enabled"
          );
        } catch (error: unknown) {
          console.error("Failed to update minimize to tray preference:", error);
          setStatusMessage("Error saving tray preference");
        }
      } else {
        setStatusMessage(`[Web Preview] Minimize to tray set to ${newValue}`);
      }
    },
    [] // stable: isTauri is a module const; state setters are always stable references
  );

  return (
    <div className="app-container">
      {/* Sleek App Header Bar */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-icon">
            <AppWindow size={18} />
          </div>
          <span className="brand-title">Minimalistic App</span>
        </div>
        <div className="tray-status-badge">
          <span className="status-dot"></span>
          <span>Taskbar Tray Active</span>
        </div>
      </header>

      {/* Main Content View */}
      <main className="app-content">
        {/* Single Tab Navigation — static decoration, non-interactive */}
        <div className="navigation-tab">
          <div className="tab-btn active">
            <Settings size={14} />
            <span>Preferences</span>
          </div>
        </div>

        {/* Settings Card */}
        <div className="settings-card">
          <div className="settings-card-header">
            <h2 className="settings-card-title">Application Settings</h2>
            <p className="settings-card-desc">
              Manage background system tray behaviors, software updates, and startup configuration.
            </p>
          </div>

          {/* Toggle 1: Start at OS launch */}
          <div className="setting-item">
            <div className="setting-info">
              <div className="setting-icon">
                <Power size={18} />
              </div>
              <div className="setting-text">
                <span className="setting-title">Start at OS launch</span>
                <span className="setting-subtitle">
                  Automatically start this app silently in the taskbar when your OS boots up.
                </span>
              </div>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={autostart}
                onChange={handleAutostartToggle}
              />
              <span className="slider"></span>
            </label>
          </div>

          {/* Toggle 2: Minimize to taskbar on close */}
          <div className="setting-item">
            <div className="setting-info">
              <div className="setting-icon">
                <Minimize2 size={18} />
              </div>
              <div className="setting-text">
                <span className="setting-title">Minimize to taskbar on close</span>
                <span className="setting-subtitle">
                  Closing the main window keeps the app running in the system tray icon drop-down menu.
                </span>
              </div>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={minimizeToTray}
                onChange={handleMinimizeToTrayToggle}
              />
              <span className="slider"></span>
            </label>
          </div>

          {/* Section 3: Auto-Update Checker (Handy-inspired) */}
          <UpdateChecker onStatusChange={setStatusMessage} variant="card" />
        </div>
      </main>

      {/* Status Footer */}
      <footer className="app-footer">
        <div className="footer-status">
          <Shield size={12} color="var(--accent-cyan)" />
          <span>Status: {statusMessage}</span>
        </div>
        <UpdateChecker variant="footer" />
      </footer>
    </div>
  );
}
