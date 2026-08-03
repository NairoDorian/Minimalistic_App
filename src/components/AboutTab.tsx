import { AppWindow, Cpu, HardDrive, Terminal } from "lucide-react";

/** Runtime platform and version metadata returned by the `get_app_info` IPC command. */
export interface AppInfo {
  /** Product name from `tauri.conf.json` (via `AppHandle::package_info()`). */
  name: string;
  /** App version from `tauri.conf.json` (via `AppHandle::package_info()`). */
  version: string;
  /** Tauri framework version the backend binary was compiled against. */
  tauri_version: string;
  /** Target operating system, e.g. `windows`, `macos`, `linux`. */
  os: string;
  /** Target CPU architecture, e.g. `x86_64`, `aarch64`. */
  arch: string;
}

// Fallback metadata used only when running in a plain browser (non-Tauri preview).
// `__APP_VERSION__` is injected by Vite `define` (see vite.config.ts); the
// platform fields are neutral ("Web Browser" / "unknown") — never assumed.
export const WEB_PREVIEW_APP_INFO: AppInfo = {
  name: "Minimalistic App",
  version: __APP_VERSION__,
  tauri_version: "2.11 (Web Preview)",
  os: "Web Browser",
  arch: "unknown",
};

interface AboutTabProps {
  /** App + runtime metadata from the Rust backend, or null while loading. */
  appInfo: AppInfo | null;
}

/**
 * System & About tab panel — purely presentational.
 *
 * Displays application version, Tauri core version, platform/architecture,
 * and template key highlights. All data arrives via the `appInfo` prop:
 * `App.tsx` owns the IPC fetch and the `WEB_PREVIEW_APP_INFO` fallback.
 */
export function AboutTab({ appInfo }: AboutTabProps) {
  return (
    <div
      className="settings-card"
      id="panel-about"
      role="tabpanel"
      aria-labelledby="tab-about"
    >
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
          <span className="tile-value">v{appInfo?.version ?? __APP_VERSION__}</span>
        </div>

        <div className="info-tile">
          <div className="tile-header">
            <Cpu size={16} color="var(--accent-cyan)" />
            <span className="tile-title">Tauri Core Engine</span>
          </div>
          <span className="tile-value">v{appInfo?.tauri_version || WEB_PREVIEW_APP_INFO.tauri_version}</span>
        </div>

        <div className="info-tile">
          <div className="tile-header">
            <HardDrive size={16} color="var(--accent-cyan)" />
            <span className="tile-title">Target Platform / Arch</span>
          </div>
          <span className="tile-value">
            {appInfo?.os || "unknown"} ({appInfo?.arch || "unknown"})
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
  );
}
