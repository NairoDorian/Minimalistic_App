import { createSignal, createMemo, Show, untrack } from 'solid-js';
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
  Package,
} from '../lib/icons';
import { toast } from '../lib/toast';
import { isTauri } from '../lib/tauri';
import { APP_NAME, APP_SLUG } from '../lib/appMeta';
import { formatShortcutLabel } from '../lib/shortcuts';
import { downloadTextFile } from '../lib/download';

export const WEB_PREVIEW_APP_INFO: AppInfo = {
  name: APP_NAME,
  version: __APP_VERSION__,
  tauri_version: '2.11 (Web Preview)',
  os: 'Web Browser',
  arch: 'unknown',
};

interface AboutTabProps {
  /** Async memo accessor resolving to the app's metadata (see App.tsx). */
  appInfo: () => AppInfo;
  onStatusChange?: (status: string) => void;
  onOpenShortcuts?: () => void;
}

export function AboutTab(props: AboutTabProps) {
  const [copied, setCopied] = createSignal(false);

  /**
   * Where the app is actually writing settings and logs.
   *
   * Worth surfacing because it is not always the OS config directory: dropping a
   * file named `portable` beside the executable redirects everything into
   * `<exe dir>/Data`, and a user who does that (or receives a pre-configured
   * portable copy) should be able to confirm it without hunting through the
   * filesystem. Falls back to a neutral placeholder in the browser preview,
   * where there is no backend to ask.
   */
  const storage = createMemo(async () => {
    if (!isTauri) {
      return { active: false, data_dir: 'Browser preview — nothing is written to disk' };
    }
    try {
      return await commands.getPortableStatus();
    } catch (err: unknown) {
      console.warn('Portable status query failed:', err);
      return { active: false, data_dir: 'unavailable' };
    }
  });

  /**
   * Builds the shared markdown diagnostics block used by both copy and report export.
   *
   * Reads the app-info accessor through `untrack` — this runs in an event handler
   * (click), not a tracking scope, so a plain read returns the last settled
   * value without subscribing. By the time the user clicks, the startup IPC
   * memo has resolved.
   */
  const buildDiagnosticsText = (): string => {
    const info = untrack(() => props.appInfo());
    return [
      '```markdown',
      `- Application: ${info.name} v${info.version}`,
      `- Tauri Engine: v${info.tauri_version}`,
      `- OS / Architecture: ${info.os} (${info.arch})`,
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
      `${APP_NAME} — Diagnostic Report`,
      `Generated: ${new Date().toISOString()}`,
      '',
      buildDiagnosticsText(),
    ].join('\n');

    const version = untrack(() => props.appInfo()).version;
    downloadTextFile(`${APP_SLUG}-diagnostics-${version}.txt`, report, 'text/plain;charset=utf-8');
    toast.success('Diagnostic report downloaded');
    props.onStatusChange?.('Diagnostic report saved');
  };

  const handleOpenConfigDir = async () => {
    if (!isTauri) {
      toast.info('[Web Preview] Opening the app config directory requires the desktop build');
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

  // NOTE: `props.appInfo()` is read inside JSX expressions so each tile subscribes
  // to the async memo — when the startup IPC settles (or revalidates), the tiles
  // update automatically. The About tab is always rendered under an <Errored> and
  // a parent <Loading> boundary, so the not-ready state is absorbed by Loading.
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
          <span class="tile-value">v{props.appInfo().version}</span>
        </div>

        <div class="info-tile">
          <div class="tile-header">
            <Cpu size={16} color="var(--accent-cyan)" />
            <span class="tile-title">Tauri Core Engine</span>
          </div>
          <span class="tile-value">v{props.appInfo().tauri_version}</span>
        </div>

        <div class="info-tile">
          <div class="tile-header">
            <HardDrive size={16} color="var(--accent-cyan)" />
            <span class="tile-title">Target Platform / Arch</span>
          </div>
          <span class="tile-value">
            {props.appInfo().os} ({props.appInfo().arch})
          </span>
        </div>

        <div class="info-tile">
          <div class="tile-header">
            <Terminal size={16} color="var(--accent-cyan)" />
            <span class="tile-title">Tech Stack Standards</span>
          </div>
          <span class="tile-value">Bun 1.3+ | SolidJS 2 | Rust 2024</span>
        </div>

        <div class="info-tile info-tile-wide">
          <div class="tile-header">
            <Package size={16} color="var(--accent-cyan)" />
            <span class="tile-title">
              Data Location {storage().active ? '(Portable)' : '(System)'}
            </span>
          </div>
          {/* The path can be long, so it gets the full grid width and its own
              wrapping rule rather than being truncated into uselessness. */}
          <span class="tile-value tile-value-path" title={storage().data_dir}>
            {storage().data_dir}
          </span>
          <Show when={storage().active}>
            <span class="tile-hint">
              A <code>portable</code> marker file beside the executable is redirecting settings and
              logs here instead of the OS directories.
            </span>
          </Show>
        </div>
      </div>

      <div class="about-notes-box">
        <div class="notes-header-row">
          <span class="notes-heading">Template Key Highlights</span>
          <button
            type="button"
            class="btn-shortcuts-hint"
            onClick={props.onOpenShortcuts}
            title={`Press ? or ${formatShortcutLabel('show-shortcuts')} for the shortcut list`}
          >
            Shortcuts ({formatShortcutLabel('show-shortcuts')})
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
