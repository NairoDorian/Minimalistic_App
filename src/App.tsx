import { useState, useEffect, useCallback, type KeyboardEvent } from "react";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { invoke } from "@tauri-apps/api/core";
import { Settings, Power, Minimize2, Shield, AppWindow, Info, Cpu, HardDrive, Terminal } from "lucide-react";
import { UpdateChecker } from "./components/UpdateChecker";
import { isTauri } from "./lib/tauri";

interface AppInfo {
  name: string;
  version: string;
  tauri_version: string;
  os: string;
  arch: string;
}

type TabType = "preferences" | "about";

/**
 * Main Application GUI Component (React 19).
 * Provides a sleek, AMOLED pitch-black preferences and system information interface:
 * 1. Modular Tab Navigation (Preferences, System Info & About)
 * 2. OS Launch Autostart & Persistent Taskbar Tray Preferences
 * 3. GitHub Release Auto-Updater Integration
 * 4. Native Window Drag Region (`data-tauri-drag-region`)
 * 5. Full ARIA Accessibility & Keyboard Navigation (Space / Enter toggles)
 */
export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>("preferences");
  const [autostart, setAutostart] = useState<boolean>(false);
  const [minimizeToTray, setMinimizeToTray] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("Ready");
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  // Load initial settings and platform metadata asynchronously
  useEffect(() => {
    if (!isTauri) {
      setAppInfo({
        name: "Minimalistic App",
        version: "0.1.0",
        tauri_version: "2.11 (Web Preview)",
        os: "Web Browser",
        arch: "x86_64",
      });
      return;
    }

    Promise.all([
      isEnabled().catch((err: unknown) => {
        console.warn("Autostart check failed:", err);
        return false;
      }),
      invoke<boolean>("get_minimize_to_tray").catch((err: unknown) => {
        console.warn("Minimize to tray check failed:", err);
        return false;
      }),
      invoke<AppInfo>("get_app_info").catch((err: unknown) => {
        console.warn("App info IPC query failed:", err);
        return null;
      }),
    ]).then(([autostartEnabled, minimizeEnabled, info]) => {
      setAutostart(autostartEnabled);
      setMinimizeToTray(minimizeEnabled);
      if (info) setAppInfo(info);
    });
  }, []);

  /**
   * Helper to set status message with auto-clear timeout.
   */
  const updateStatus = useCallback((msg: string) => {
    setStatusMessage(msg);
  }, []);

  /**
   * Toggles OS Startup setting via Tauri autostart plugin.
   */
  const handleAutostartToggle = useCallback(
    async (newValue: boolean) => {
      setAutostart(newValue);

      if (isTauri) {
        try {
          if (newValue) {
            await enable();
            updateStatus("Autostart enabled for OS startup");
          } else {
            await disable();
            updateStatus("Autostart disabled");
          }
        } catch (error: unknown) {
          console.error("Failed to toggle autostart:", error);
          updateStatus("Error setting autostart");
        }
      } else {
        updateStatus(`[Web Preview] Autostart set to ${newValue}`);
      }
    },
    [updateStatus]
  );

  /**
   * Toggles Minimize to System Tray setting via Rust IPC invoke command.
   */
  const handleMinimizeToTrayToggle = useCallback(
    async (newValue: boolean) => {
      setMinimizeToTray(newValue);

      if (isTauri) {
        try {
          await invoke("set_minimize_to_tray", { enabled: newValue });
          updateStatus(
            newValue
              ? "Minimize to tray on close enabled (Saved)"
              : "Quit on window close enabled (Saved)"
          );
        } catch (error: unknown) {
          console.error("Failed to update minimize to tray preference:", error);
          updateStatus("Error saving tray preference");
        }
      } else {
        updateStatus(`[Web Preview] Minimize to tray set to ${newValue}`);
      }
    },
    [updateStatus]
  );

  /**
   * Keyboard accessible switch toggle handler for Space / Enter keys.
   */
  const handleKeyDown = (
    e: KeyboardEvent<HTMLLabelElement>,
    currentValue: boolean,
    toggleFn: (val: boolean) => void
  ) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggleFn(!currentValue);
    }
  };

  return (
    <div className="app-container">
      {/* Sleek Native Window Header Bar with data-tauri-drag-region */}
      <header className="app-header" data-tauri-drag-region>
        <div className="brand-section" data-tauri-drag-region>
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

      {/* Main Content Area */}
      <main className="app-content">
        {/* Modular Tab Navigation Header */}
        <nav className="navigation-tab" aria-label="Main Navigation">
          <button
            type="button"
            className={`tab-btn ${activeTab === "preferences" ? "active" : ""}`}
            onClick={() => setActiveTab("preferences")}
            aria-selected={activeTab === "preferences"}
            role="tab"
          >
            <Settings size={14} />
            <span>Preferences</span>
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "about" ? "active" : ""}`}
            onClick={() => setActiveTab("about")}
            aria-selected={activeTab === "about"}
            role="tab"
          >
            <Info size={14} />
            <span>System & About</span>
          </button>
        </nav>

        {/* Tab View 1: Preferences */}
        {activeTab === "preferences" && (
          <div className="settings-card">
            <div className="settings-card-header">
              <h2 className="settings-card-title">Application Settings</h2>
              <p className="settings-card-desc">
                Configure taskbar system tray behavior, OS startup preferences, and software updates.
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
                    Automatically start this app silently in the system tray when your computer starts.
                  </span>
                </div>
              </div>
              <label
                className="switch"
                tabIndex={0}
                role="switch"
                aria-checked={autostart}
                aria-label="Start at OS launch"
                onKeyDown={(e) => handleKeyDown(e, autostart, handleAutostartToggle)}
              >
                <input
                  type="checkbox"
                  checked={autostart}
                  onChange={(e) => handleAutostartToggle(e.target.checked)}
                  tabIndex={-1}
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
                    Closing the window keeps the app running in the taskbar tray. State persists on disk.
                  </span>
                </div>
              </div>
              <label
                className="switch"
                tabIndex={0}
                role="switch"
                aria-checked={minimizeToTray}
                aria-label="Minimize to taskbar on close"
                onKeyDown={(e) => handleKeyDown(e, minimizeToTray, handleMinimizeToTrayToggle)}
              >
                <input
                  type="checkbox"
                  checked={minimizeToTray}
                  onChange={(e) => handleMinimizeToTrayToggle(e.target.checked)}
                  tabIndex={-1}
                />
                <span className="slider"></span>
              </label>
            </div>

            {/* Section 3: Auto-Update Checker */}
            <UpdateChecker onStatusChange={updateStatus} variant="card" />
          </div>
        )}

        {/* Tab View 2: System Info & About */}
        {activeTab === "about" && (
          <div className="settings-card">
            <div className="settings-card-header">
              <h2 className="settings-card-title">System & Architecture Metadata</h2>
              <p className="settings-card-desc">
                Production details and runtime environmental specifications of this starter template.
              </p>
            </div>

            <div className="system-info-grid">
              <div className="info-tile">
                <div className="tile-header">
                  <AppWindow size={16} color="var(--accent-cyan)" />
                  <span className="tile-title">Application Version</span>
                </div>
                <span className="tile-value">v{appInfo?.version || "0.1.0"}</span>
              </div>

              <div className="info-tile">
                <div className="tile-header">
                  <Cpu size={16} color="var(--accent-cyan)" />
                  <span className="tile-title">Tauri Core Engine</span>
                </div>
                <span className="tile-value">v{appInfo?.tauri_version || "2.11"}</span>
              </div>

              <div className="info-tile">
                <div className="tile-header">
                  <HardDrive size={16} color="var(--accent-cyan)" />
                  <span className="tile-title">Target Platform / Arch</span>
                </div>
                <span className="tile-value">
                  {appInfo?.os || "win32"} ({appInfo?.arch || "x86_64"})
                </span>
              </div>

              <div className="info-tile">
                <div className="tile-header">
                  <Terminal size={16} color="var(--accent-cyan)" />
                  <span className="tile-title">Tech Stack Standards</span>
                </div>
                <span className="tile-value">Bun 1.3+ | React 19 | Rust 2024</span>
              </div>
            </div>

            <div className="about-notes-box">
              <span className="notes-heading">Template Key Highlights</span>
              <ul className="notes-list">
                <li>100% AMOLED pitch black (#000000) glassmorphic dark mode styling.</li>
                <li>Native system tray left-click toggle & context menu teardown integration.</li>
                <li>Disk-backed JSON settings persistence in <code>$APP_DATA_DIR/settings.json</code>.</li>
                <li>GitHub Release auto-updates with streamed progress & Minisign security verification.</li>
              </ul>
            </div>
          </div>
        )}
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

