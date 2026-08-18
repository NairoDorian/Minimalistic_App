import { createSignal } from 'solid-js';
import { commands } from '../bindings';
import type { AppInfo } from '../bindings';
import {
  AppWindow,
  Cpu,
  HardDrive,
  Terminal,
  Copy,
  Check,
  FolderOpen,
  Download,
} from '../lib/icons';
import { toast } from '../lib/toast';
import { isTauri } from '../lib/tauri';

export const WEB_PREVIEW_APP_INFO: AppInfo = {
  name: 'Minimalistic App',
  version: __APP_VERSION__,
  tauri_version: '2.11 (Web Preview)',
  os: 'Web Browser',
  arch: 'unknown',
};

interface AboutTabProps {
  appInfo: () => AppInfo | null;
  onStatusChange?: (status: string) => void;
  onOpenShortcuts?: () => void;
}

export function AboutTab(props: AboutTabProps) {
  const [copied, setCopied] = createSignal(false);

  /** Builds the shared markdown diagnostics block used by both copy and report export. */
  const buildDiagnosticsText = (): string => {
    const info = props.appInfo();
    const version = info?.version ?? __APP_VERSION__;
    const tauriVer = info?.tauri_version ?? WEB_PREVIEW_APP_INFO.tauri_version;
    const os = info?.os ?? 'unknown';
    const arch = info?.arch ?? 'unknown';

    return [
      '```markdown',
      `- Application: ${info?.name ?? 'Minimalistic App'} v${version}`,
      `- Tauri Engine: v${tauriVer}`,
      `- OS / Architecture: ${os} (${arch})`,
      `- Runtime Stack: Bun 1.3+ | SolidJS 2 | Cargo Rust 2024`,
      '```',
    ].join('\n');
  };

  const handleCopyDiagnostics = async () => {
    const diagText = buildDiagnosticsText();

    try {
      await navigator.clipboard.writeText(diagText);
      setCopied(true);
      toast.success('Diagnostics copied to clipboard');
      props.onStatusChange?.('Diagnostic info copied to clipboard');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error('Failed to copy diagnostic info');
      props.onStatusChange?.('Failed to copy diagnostic info');
    }
  };

  /** Exports a timestamped diagnostic report as a downloadable `.txt` file (Blob download). */
  const handleSaveReport = () => {
    const report = [
      'Minimalistic App — Diagnostic Report',
      `Generated: ${new Date().toISOString()}`,
      '',
      buildDiagnosticsText(),
    ].join('\n');

    const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `minimalistic-app-diagnostics-${props.appInfo()?.version ?? __APP_VERSION__}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Diagnostic report downloaded');
    props.onStatusChange?.('Diagnostic report saved');
  };

  const handleOpenConfigDir = async () => {
    if (!isTauri) {
      toast.info('[Web Preview] Simulated opening %APPDATA%\\com.minimalistic.app');
      return;
    }
    try {
      await commands.openAppDataDir();
      toast.success('Opened App Configuration Directory in Explorer/Finder');
      props.onStatusChange?.('Opened app config folder');
    } catch (err: unknown) {
      toast.error(`Could not open directory: ${String(err)}`);
    }
  };

  const info = props.appInfo();

  return (
    <div
      class="settings-card"
      id="panel-about"
      role="tabpanel"
      tabindex={0}
      aria-labelledby="tab-about"
    >
      <div class="settings-card-header">
        <div class="card-header-row">
          <div>
            <h2 class="settings-card-title">System & Architecture Metadata</h2>
            <p class="settings-card-desc">
              Production details and runtime environmental specifications of this starter template.
            </p>
          </div>
          <div class="header-actions-group">
            <button
              type="button"
              class="btn-copy-diagnostics"
              onClick={handleOpenConfigDir}
              aria-label="Open application configuration directory"
              title="Open config directory in file explorer"
            >
              <FolderOpen size={13} />
              <span>Config Dir</span>
            </button>
            <button
              type="button"
              class={`btn-copy-diagnostics ${copied() ? 'copied' : ''}`}
              onClick={handleCopyDiagnostics}
              aria-label="Copy system diagnostic info to clipboard"
              title="Copy system diagnostics"
            >
              {copied() ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied() ? 'Copied!' : 'Copy Diags'}</span>
            </button>
            <button
              type="button"
              class="btn-copy-diagnostics"
              onClick={handleSaveReport}
              aria-label="Download diagnostic report as text file"
              title="Save diagnostic report (.txt)"
            >
              <Download size={13} />
              <span>Save Report</span>
            </button>
          </div>
        </div>
      </div>

      <div class="system-info-grid">
        <div class="info-tile">
          <div class="tile-header">
            <AppWindow size={16} color="var(--accent-cyan)" />
            <span class="tile-title">Application Version</span>
          </div>
          <span class="tile-value">v{info?.version ?? __APP_VERSION__}</span>
        </div>

        <div class="info-tile">
          <div class="tile-header">
            <Cpu size={16} color="var(--accent-cyan)" />
            <span class="tile-title">Tauri Core Engine</span>
          </div>
          <span class="tile-value">
            v{info?.tauri_version ?? WEB_PREVIEW_APP_INFO.tauri_version}
          </span>
        </div>

        <div class="info-tile">
          <div class="tile-header">
            <HardDrive size={16} color="var(--accent-cyan)" />
            <span class="tile-title">Target Platform / Arch</span>
          </div>
          <span class="tile-value">
            {info?.os ?? 'unknown'} ({info?.arch ?? 'unknown'})
          </span>
        </div>

        <div class="info-tile">
          <div class="tile-header">
            <Terminal size={16} color="var(--accent-cyan)" />
            <span class="tile-title">Tech Stack Standards</span>
          </div>
          <span class="tile-value">Bun 1.3+ | SolidJS 2 | Rust 2024</span>
        </div>
      </div>

      <div class="about-notes-box">
        <div class="notes-header-row">
          <span class="notes-heading">Template Key Highlights</span>
          <button
            type="button"
            class="btn-shortcuts-hint"
            onClick={props.onOpenShortcuts}
            title="Press ? or Ctrl+/ for shortcut list"
          >
            Shortcuts (Ctrl+/)
          </button>
        </div>
        <ul class="notes-list">
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
