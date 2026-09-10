import { createSignal, onSettled, For } from 'solid-js';
import { commands } from '../bindings';
import type { AppSettings } from '../bindings';
import {
  Code,
  Terminal,
  FolderOpen,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Info,
  AlertTriangle,
  Play,
  Download,
  Upload,
  Bell,
} from '../lib/icons';
import { toast } from '../lib/toast';
import { isTauri } from '../lib/tauri';
import { devLog } from '../lib/console';
import { APP_NAME } from '../lib/appMeta';
import {
  sendAppNotification,
  checkNotificationPermission,
  requestNotificationPermission,
  type NotificationPermissionState,
} from '../lib/notification';
import { applyThemeAccent, resolveThemeAccent, THEME_ACCENT_STORAGE_KEY } from '../lib/theme';
import { readStored, writeStored } from '../lib/storage';
import {
  sanitizeSettings,
  downloadSettingsFile,
  readSettingsFile,
  FALLBACK_SETTINGS,
} from '../lib/settingsBackup';
import { DevConsole } from './DevConsole';

interface DeveloperTabProps {
  onStatusChange?: (status: string) => void;
  onSettingsReset?: () => void;
}

/** One read-only IPC command the playground can invoke. */
interface PlaygroundCommand {
  /** The Rust command name, exactly as registered in `collect_commands!`. */
  readonly id: string;
  readonly desc: string;
  /** The generated Tauri Specta wrapper — type-safe, never a string `invoke`. */
  readonly run: () => Promise<unknown>;
}

/**
 * The commands the playground offers, in menu order.
 *
 * One list drives both the `<select>` and the dispatch, so a command cannot be
 * listed without being runnable, or runnable without being listed — the two
 * parallel tables this replaces could drift. Only read-only commands belong
 * here: the point is to inspect what the backend returns, and the destructive
 * actions have their own guarded buttons further down the tab.
 */
const PLAYGROUND_COMMANDS: readonly PlaygroundCommand[] = [
  {
    id: 'get_app_info',
    desc: 'Fetch product metadata & versions',
    run: () => commands.getAppInfo(),
  },
  {
    id: 'get_app_settings',
    desc: 'Fetch persisted AppSettings JSON',
    run: () => commands.getAppSettings(),
  },
  {
    id: 'get_system_stats',
    desc: 'Fetch process and system telemetry',
    run: () => commands.getSystemStats(),
  },
];

export function DeveloperTab(props: DeveloperTabProps) {
  const [selectedCommand, setSelectedCommand] = createSignal<string>('get_app_info');
  const [isRunning, setRunning] = createSignal<boolean>(false);
  const [resetConfirm, setResetConfirm] = createSignal<boolean>(false);
  const [viewport, setViewport] = createSignal({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
    pixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
  });
  // `APP_NAME`, never a literal: `rename-project` rewrites `appMeta.ts` and
  // nothing else in the frontend, so a hardcoded name here would survive a
  // rebrand as the one place still saying the old product name.
  const [notifTitle, setNotifTitle] = createSignal<string>(APP_NAME);
  const [notifBody, setNotifBody] = createSignal<string>(
    'Hello from cross-platform desktop notification service!'
  );
  const [notifPermission, setNotifPermission] =
    createSignal<NotificationPermissionState>('default');
  const [isSendingNotif, setIsSendingNotif] = createSignal<boolean>(false);

  let fileInput: HTMLInputElement | undefined;
  /** Timer that expires the two-step reset confirmation. */
  let resetConfirmTimeout: ReturnType<typeof setTimeout> | null = null;

  onSettled(() => {
    void checkNotificationPermission().then(setNotifPermission);

    const handleResize = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
        pixelRatio: window.devicePixelRatio,
      });
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      // Switching tabs unmounts this panel; a pending confirmation timer must
      // not outlive it and write to a disposed signal.
      if (resetConfirmTimeout) clearTimeout(resetConfirmTimeout);
    };
  });

  const handleSendNotification = async () => {
    setIsSendingNotif(true);
    try {
      devLog.info(`Dispatching OS notification: "${notifTitle()}" - "${notifBody()}"`);
      const result = await sendAppNotification({
        title: notifTitle(),
        body: notifBody(),
      });
      setNotifPermission(result.permission);
      devLog.success(
        `Notification dispatched (via ${result.deliveredVia}, permission: ${result.permission})`
      );
      toast.success(`Notification sent (${result.deliveredVia})`);
      props.onStatusChange?.(`Notification sent (${result.deliveredVia})`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      devLog.error(`Notification failed: ${msg}`);
      toast.error(`Notification error: ${msg}`);
    } finally {
      setIsSendingNotif(false);
    }
  };

  const handleRequestPermission = async () => {
    try {
      const perm = await requestNotificationPermission();
      setNotifPermission(perm);
      devLog.info(`Notification permission requested -> ${perm}`);
      toast.info(`Notification permission: ${perm}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      devLog.error(`Permission request failed: ${msg}`);
      toast.error(`Permission error: ${msg}`);
    }
  };

  const handleRunCommand = async () => {
    if (!isTauri) {
      devLog.info(`Mock ${selectedCommand()} (Web Preview)`);
      const mock = {
        mockResult: true,
        command: selectedCommand(),
        environment: 'Web Browser Preview',
        timestamp: new Date().toISOString(),
      };
      devLog.success(JSON.stringify(mock));
      toast.info(`[Web Preview] Executed mock ${selectedCommand()}`);
      return;
    }

    setRunning(true);
    devLog.info(`Invoking IPC ${selectedCommand()}...`);
    try {
      const command = PLAYGROUND_COMMANDS.find((entry) => entry.id === selectedCommand());
      if (!command) throw new Error(`Unknown command: ${selectedCommand()}`);
      const result = await command.run();
      devLog.success(`IPC ${selectedCommand()} -> ${JSON.stringify(result)}`);
      toast.success(`IPC '${selectedCommand()}' executed successfully`);
      props.onStatusChange?.(`IPC '${selectedCommand()}' executed`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      devLog.error(`IPC ${selectedCommand()} failed: ${errMsg}`);
      toast.error(`IPC error: ${errMsg}`);
      props.onStatusChange?.(`IPC error on ${selectedCommand()}`);
    } finally {
      setRunning(false);
    }
  };

  const handleOpenConfigDir = async () => {
    if (!isTauri) {
      devLog.info('Open config dir simulated (Web Preview)');
      toast.info('[Web Preview] Opening the app config directory requires the desktop build');
      return;
    }

    try {
      await commands.openAppDataDir();
      devLog.success('Opened app configuration directory');
      toast.success('Opened App Configuration Directory in Explorer/Finder');
      props.onStatusChange?.('Opened app config folder');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      devLog.error(`Failed to open config dir: ${msg}`);
      toast.error(`Failed to open directory: ${msg}`);
    }
  };

  const handleResetSettings = async () => {
    if (!resetConfirm()) {
      setResetConfirm(true);
      devLog.warn('Reset requires confirmation — click again within 4s');
      // Restart the window on every arming click rather than stacking timers.
      if (resetConfirmTimeout) clearTimeout(resetConfirmTimeout);
      resetConfirmTimeout = setTimeout(() => {
        setResetConfirm(false);
        resetConfirmTimeout = null;
      }, 4000);
      return;
    }

    if (isTauri) {
      try {
        await commands.resetAppSettings();
        devLog.warn('Settings reset to factory defaults');
        toast.success('App settings restored to factory defaults');
        props.onSettingsReset?.();
        props.onStatusChange?.('Settings restored to defaults');
      } catch (err: unknown) {
        devLog.error(`Reset failed: ${String(err)}`);
        toast.error(`Failed to reset settings: ${String(err)}`);
      }
    } else {
      devLog.warn('Settings reset simulated (Web Preview)');
      toast.success('[Web Preview] Settings reset to default');
      props.onSettingsReset?.();
    }
    if (resetConfirmTimeout) {
      clearTimeout(resetConfirmTimeout);
      resetConfirmTimeout = null;
    }
    setResetConfirm(false);
  };

  /** Exports the current persisted settings as a sanitized JSON backup file. */
  const handleExportSettings = async () => {
    if (isTauri) {
      try {
        const current = await commands.getAppSettings();
        const safe = sanitizeSettings(current, FALLBACK_SETTINGS);
        downloadSettingsFile(safe, __APP_VERSION__);
        devLog.success('Settings backup exported to JSON');
        toast.success('Settings backup downloaded');
        props.onStatusChange?.('Settings backup exported');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        devLog.error(`Export failed: ${msg}`);
        toast.error(`Export failed: ${msg}`);
      }
    } else {
      // The browser preview keeps only the accent, in localStorage; every other
      // field is the factory default. `resolveThemeAccent` validates the stored
      // id the way the desktop loader does, so a stale or hand-edited value can
      // never be exported as if it named a real preset.
      const current: AppSettings = {
        ...FALLBACK_SETTINGS,
        theme_accent: resolveThemeAccent(readStored(THEME_ACCENT_STORAGE_KEY)),
      };
      downloadSettingsFile(current, __APP_VERSION__);
      devLog.success('Settings backup exported (Web Preview)');
      toast.success('[Web Preview] Settings backup downloaded');
    }
  };

  /** Restores settings from a user-selected backup file through the sanitizer. */
  const handleImportSettings = async (file: File) => {
    try {
      const parsed = await readSettingsFile(file);

      if (isTauri) {
        const current = await commands.getAppSettings();
        const sanitized = sanitizeSettings(parsed, current);
        await commands.updateAppSettings(sanitized);
        applyThemeAccent(sanitized.theme_accent);
      } else {
        const sanitized = sanitizeSettings(parsed, FALLBACK_SETTINGS);
        writeStored(THEME_ACCENT_STORAGE_KEY, sanitized.theme_accent);
        applyThemeAccent(sanitized.theme_accent);
      }

      devLog.success(`Settings imported from ${file.name} (sanitized)`);
      toast.success('Settings restored from backup');
      props.onStatusChange?.('Settings restored from backup');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      devLog.error(`Import failed (${file.name}): ${msg}`);
      toast.error(`Import failed: ${msg}`);
    }
  };

  const handleFileChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file on the next import
    if (file) void handleImportSettings(file);
  };

  return (
    <div
      class="settings-card"
      id="panel-developer"
      role="tabpanel"
      tabindex={0}
      aria-labelledby="tab-developer"
    >
      <div class="settings-card-header">
        <h2 class="settings-card-title">Developer Hub & IPC Playground</h2>
        <p class="settings-card-desc">
          Live developer tools, real-time IPC command testing, and runtime diagnostics.
        </p>
      </div>

      {/* IPC Playground + Activity Console */}
      <div class="dev-section">
        <div class="dev-section-header">
          <Terminal size={16} color="var(--accent-cyan)" />
          <span class="dev-section-title">Rust IPC Command Inspector</span>
        </div>

        <div class="ipc-runner-bar">
          <select
            class="ipc-select"
            value={selectedCommand()}
            onChange={(e) => setSelectedCommand(e.currentTarget.value)}
            aria-label="Select IPC command to execute"
          >
            <For each={PLAYGROUND_COMMANDS} keyed>
              {(cmd) => (
                <option value={cmd.id}>
                  {cmd.id} — {cmd.desc}
                </option>
              )}
            </For>
          </select>
          <button
            type="button"
            class="btn-update-primary"
            onClick={handleRunCommand}
            disabled={isRunning()}
          >
            <Play size={13} />
            <span>{isRunning() ? 'Invoking...' : 'Execute'}</span>
          </button>
        </div>

        <DevConsole />
      </div>

      {/* Settings Backup & Restore */}
      <div class="dev-section">
        <div class="dev-section-header">
          <Code size={16} color="var(--accent-cyan)" />
          <span class="dev-section-title">Settings Backup & Restore</span>
        </div>
        <p class="dev-section-desc">
          Export settings to a portable JSON backup or restore from one. Imports are sanitized —
          invalid fields fall back to current values and unknown fields are dropped.
        </p>

        <div class="dev-quick-actions">
          <button type="button" class="btn-update-secondary" onClick={handleExportSettings}>
            <Download size={14} />
            <span>Export Backup</span>
          </button>
          <button type="button" class="btn-update-secondary" onClick={() => fileInput?.click()}>
            <Upload size={14} />
            <span>Import Backup</span>
          </button>
          <input
            ref={(el) => (fileInput = el ?? undefined)}
            type="file"
            accept=".json,application/json"
            class="visually-hidden"
            onChange={handleFileChange}
            aria-hidden="true"
            tabindex={-1}
          />
        </div>
      </div>

      {/* Interactive OS Notification & Toast Benchmark */}
      <div class="dev-section">
        <div class="dev-section-header">
          <Bell size={16} color="var(--accent-cyan)" />
          <span class="dev-section-title">Cross-Platform OS Notification Service</span>
          <span class={`notif-perm-badge perm-${notifPermission()}`}>
            Permission: {notifPermission()}
          </span>
        </div>
        <p class="dev-section-desc">
          Dispatches native operating system desktop notifications (via Tauri 2 Notification plugin)
          with browser Web Notification API and in-app toast fallbacks.
        </p>

        <div class="notif-bench-controls">
          <div class="notif-input-group">
            <label class="notif-input-label" for="notif-title-input">
              Title
            </label>
            <input
              id="notif-title-input"
              type="text"
              class="notif-text-input"
              value={notifTitle()}
              onInput={(e) => setNotifTitle(e.currentTarget.value)}
              placeholder="Notification Title"
            />
          </div>
          <div class="notif-input-group">
            <label class="notif-input-label" for="notif-body-input">
              Message
            </label>
            <input
              id="notif-body-input"
              type="text"
              class="notif-text-input"
              value={notifBody()}
              onInput={(e) => setNotifBody(e.currentTarget.value)}
              placeholder="Notification Message Body"
            />
          </div>
        </div>

        <div class="notif-actions-bar">
          <button
            type="button"
            class="btn-update-primary"
            onClick={handleSendNotification}
            disabled={isSendingNotif()}
          >
            <Bell size={13} />
            <span>{isSendingNotif() ? 'Sending...' : 'Send OS Notification'}</span>
          </button>
          <button type="button" class="btn-update-secondary" onClick={handleRequestPermission}>
            <span>Request Permission</span>
          </button>
        </div>

        <div class="dev-subsection-divider">
          <span>In-App Toast Benchmark</span>
        </div>

        <div class="toast-bench-grid">
          <button
            type="button"
            class="btn-toast-test toast-test-success"
            onClick={() => toast.success('Operation completed successfully!')}
          >
            <CheckCircle2 size={13} />
            <span>Trigger Success</span>
          </button>
          <button
            type="button"
            class="btn-toast-test toast-test-info"
            onClick={() => toast.info('System background sync finished.')}
          >
            <Info size={13} />
            <span>Trigger Info</span>
          </button>
          <button
            type="button"
            class="btn-toast-test toast-test-warning"
            onClick={() => toast.warning('Network latency elevated.')}
          >
            <AlertTriangle size={13} />
            <span>Trigger Warning</span>
          </button>
          <button
            type="button"
            class="btn-toast-test toast-test-error"
            onClick={() => toast.error('Failed to commit database transaction.')}
          >
            <AlertCircle size={13} />
            <span>Trigger Error</span>
          </button>
        </div>
      </div>

      {/* Quick Diagnostics & Native Actions */}
      <div class="dev-section">
        <div class="dev-section-header">
          <FolderOpen size={16} color="var(--accent-cyan)" />
          <span class="dev-section-title">Quick Actions & Environment</span>
        </div>

        <div class="dev-quick-actions">
          <button type="button" class="btn-update-secondary" onClick={handleOpenConfigDir}>
            <FolderOpen size={14} />
            <span>Open App Data Folder</span>
          </button>
          <button
            type="button"
            class={`btn-update-secondary ${resetConfirm() ? 'btn-danger-confirm' : ''}`}
            onClick={handleResetSettings}
          >
            <RotateCcw size={14} />
            <span>{resetConfirm() ? 'Click to Confirm Reset' : 'Reset All Settings'}</span>
          </button>
        </div>

        <div class="dev-telemetry-row">
          <span>
            Viewport: {viewport().width}x{viewport().height} (DPR: {viewport().pixelRatio})
          </span>
          <span>Runtime: {isTauri ? 'Native Tauri v2' : 'Vite Dev Web'}</span>
        </div>
      </div>
    </div>
  );
}
