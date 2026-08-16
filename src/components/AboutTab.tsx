import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AppWindow, Cpu, HardDrive, Terminal, Copy, Check, FolderOpen } from 'lucide-react';
import { toast } from '../lib/toast';
import { isTauri } from '../lib/tauri';

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

export const WEB_PREVIEW_APP_INFO: AppInfo = {
  name: 'Minimalistic App',
  version: __APP_VERSION__,
  tauri_version: '2.11 (Web Preview)',
  os: 'Web Browser',
  arch: 'unknown',
};

interface AboutTabProps {
  appInfo: AppInfo | null;
  onStatusChange?: (status: string) => void;
  onOpenShortcuts?: () => void;
}

export function AboutTab({ appInfo, onStatusChange, onOpenShortcuts }: AboutTabProps) {
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopyDiagnostics = useCallback(async () => {
    const version = appInfo?.version ?? __APP_VERSION__;
    const tauriVer = appInfo?.tauri_version ?? WEB_PREVIEW_APP_INFO.tauri_version;
    const os = appInfo?.os ?? 'unknown';
    const arch = appInfo?.arch ?? 'unknown';

    const diagText = [
      '```markdown',
      `- Application: ${appInfo?.name ?? 'Minimalistic App'} v${version}`,
      `- Tauri Engine: v${tauriVer}`,
      `- OS / Architecture: ${os} (${arch})`,
      `- Runtime Stack: Bun 1.3+ | React 19 | Cargo Rust 2024`,
      '```',
    ].join('\n');

    try {
      await navigator.clipboard.writeText(diagText);
      setCopied(true);
      toast.success('Diagnostics copied to clipboard');
      onStatusChange?.('Diagnostic info copied to clipboard');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error('Failed to copy diagnostic info');
      onStatusChange?.('Failed to copy diagnostic info');
    }
  }, [appInfo, onStatusChange]);

  const handleOpenConfigDir = useCallback(async () => {
    if (!isTauri) {
      toast.info('[Web Preview] Simulated opening %APPDATA%\\com.minimalistic.app');
      return;
    }
    try {
      await invoke('open_app_data_dir');
      toast.success('Opened App Configuration Directory');
    } catch (err: unknown) {
      toast.error(`Could not open directory: ${String(err)}`);
    }
  }, []);

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
          <div className="header-actions-group">
            <button
              type="button"
              className="btn-copy-diagnostics"
              onClick={handleOpenConfigDir}
              aria-label="Open application configuration directory"
              title="Open config directory in file explorer"
            >
              <FolderOpen size={13} />
              <span>Config Dir</span>
            </button>
            <button
              type="button"
              className={`btn-copy-diagnostics ${copied ? 'copied' : ''}`}
              onClick={handleCopyDiagnostics}
              aria-label="Copy system diagnostic info to clipboard"
              title="Copy system diagnostics"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? 'Copied!' : 'Copy Diags'}</span>
            </button>
          </div>
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
          <span className="tile-value">
            v{appInfo?.tauri_version ?? WEB_PREVIEW_APP_INFO.tauri_version}
          </span>
        </div>

        <div className="info-tile">
          <div className="tile-header">
            <HardDrive size={16} color="var(--accent-cyan)" />
            <span className="tile-title">Target Platform / Arch</span>
          </div>
          <span className="tile-value">
            {appInfo?.os ?? 'unknown'} ({appInfo?.arch ?? 'unknown'})
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
        <div className="notes-header-row">
          <span className="notes-heading">Template Key Highlights</span>
          <button
            type="button"
            className="btn-shortcuts-hint"
            onClick={onOpenShortcuts}
            title="Press ? or Ctrl+/ for shortcut list"
          >
            Shortcuts (Ctrl+/)
          </button>
        </div>
        <ul className="notes-list">
          <li>100% AMOLED pitch black (#000000) glassmorphic dark mode styling.</li>
          <li>Custom theme accent palette with instant live switching and disk persistence.</li>
          <li>Native system tray left-click toggle & context menu teardown integration.</li>
          <li>
            Atomic disk-backed JSON settings persistence in <code>$APP_DATA_DIR/settings.json</code>
            .
          </li>
          <li>
            GitHub Release auto-updates with streamed progress & Minisign security verification.
          </li>
        </ul>
      </div>
    </div>
  );
}
