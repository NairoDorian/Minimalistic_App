import { useState, useCallback } from "react";
import { AppWindow, Cpu, HardDrive, Terminal, Copy, Check } from "lucide-react";

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
  /** Optional callback to notify the shared footer status bar. */
  onStatusChange?: (status: string) => void;
}

/**
 * System & About tab panel — presentational with diagnostic utility.
 *
 * Displays application version, Tauri core version, platform/architecture,
 * and template key highlights. All data arrives via the `appInfo` prop:
 * `App.tsx` owns the IPC fetch and the `WEB_PREVIEW_APP_INFO` fallback.
 *
 * Includes a 1-click "Copy Diagnostics" feature for easy troubleshooting and bug reporting.
 */
export function AboutTab({ appInfo, onStatusChange }: AboutTabProps) {
  const [copied, setCopied] = useState<boolean>(false);

  /**
   * Copies formatted diagnostic markdown to the clipboard for support / bug reporting.
   */
  const handleCopyDiagnostics = useCallback(async () => {
    const version = appInfo?.version ?? __APP_VERSION__;
    const tauriVer = appInfo?.tauri_version ?? WEB_PREVIEW_APP_INFO.tauri_version;
    const os = appInfo?.os ?? "unknown";
    const arch = appInfo?.arch ?? "unknown";

    const diagText = [
      "```markdown",
      `- Application: ${appInfo?.name ?? "Minimalistic App"} v${version}`,
      `- Tauri Engine: v${tauriVer}`,
      `- OS / Architecture: ${os} (${arch})`,
      `- Runtime Stack: Bun 1.3+ | React 19 | Cargo Rust 2024`,
      "```",
    ].join("\n");

    try {
      await navigator.clipboard.writeText(diagText);
      setCopied(true);
      onStatusChange?.("Diagnostic info copied to clipboard");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      onStatusChange?.("Failed to copy diagnostic info");
    }
  }, [appInfo, onStatusChange]);

  return (
    <div
      className="settings-card"
      id="panel-about"
      role="tabpanel"
      tabIndex={0}
      aria-labelledby="tab-about"
    >
      <div className="settings-card-header">
        <div className="card-header-row">
          <div>
            <h2 className="settings-card-title">System & Architecture Metadata</h2>
            <p className="settings-card-desc">
              Production details and runtime environmental specifications of this starter template.
            </p>
          </div>
          <button
            type="button"
            className={`btn-copy-diagnostics ${copied ? "copied" : ""}`}
            onClick={handleCopyDiagnostics}
            aria-label="Copy system diagnostic info to clipboard"
            title="Copy system diagnostics"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? "Copied!" : "Copy Diagnostics"}</span>
          </button>
        </div>
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
          <span className="tile-value">v{appInfo?.tauri_version ?? WEB_PREVIEW_APP_INFO.tauri_version}</span>
        </div>

        <div className="info-tile">
          <div className="tile-header">
            <HardDrive size={16} color="var(--accent-cyan)" />
            <span className="tile-title">Target Platform / Arch</span>
          </div>
          <span className="tile-value">
            {appInfo?.os ?? "unknown"} ({appInfo?.arch ?? "unknown"})
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
