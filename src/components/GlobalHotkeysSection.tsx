import {
  createSignal,
  createEffect,
  createMemo,
  onSettled,
  For,
  Show,
  type Component,
} from 'solid-js';
import { listen } from '@tauri-apps/api/event';
import { commands } from '../bindings';
import type { GlobalHotkeyAction, GlobalHotkeyBinding, GlobalHotkeyStatus } from '../bindings';
import { Command, AlertTriangle, Shield, RefreshCw } from '../lib/icons';
import { ToggleSwitch } from './ToggleSwitch';
import { HotkeyRecorder } from './HotkeyRecorder';
import { toast } from '../lib/toast';
import { isTauri } from '../lib/tauri';
import { IS_MAC } from '../lib/keyboard';

interface GlobalHotkeysSectionProps {
  onStatusChange?: (status: string) => void;
}

/** Labels for the actions the Rust side exposes, in its declared order. */
const ACTION_LABELS: Readonly<Record<GlobalHotkeyAction, string>> = {
  toggle_window: 'Show / hide the window',
  show_window: 'Bring the window to the front',
  check_updates: 'Check for updates',
};

/**
 * Action ids in render order, derived from ACTION_LABELS so the two can never
 * drift — the same guarantee TAB_ORDER gives the tab bar in App.tsx.
 */
const ACTION_ORDER = Object.keys(ACTION_LABELS) as readonly GlobalHotkeyAction[];

/**
 * Global hotkey configuration.
 *
 * These bindings are handled by the Rust backend's OS keyboard hook, so they
 * fire whether or not the app is focused — unlike the in-app shortcuts in the
 * cheat sheet, which only work while the window has focus. Everything here is
 * desktop-only; the browser preview renders an explanatory placeholder.
 */
export const GlobalHotkeysSection: Component<GlobalHotkeysSectionProps> = (props) => {
  const [enabled, setEnabled] = createSignal<boolean>(false);
  const [bindings, setBindings] = createSignal<GlobalHotkeyBinding[]>([]);
  const [status, setStatus] = createSignal<GlobalHotkeyStatus | null>(null);
  const [busy, setBusy] = createSignal<boolean>(false);

  /** Pulls the authoritative binding list and listener status from the backend. */
  const refresh = async () => {
    if (!isTauri) return;
    try {
      const [current, listenerStatus, settings] = await Promise.all([
        commands.getGlobalHotkeys(),
        commands.getGlobalHotkeyStatus(),
        commands.getAppSettings(),
      ]);
      setBindings(current);
      setStatus(listenerStatus);
      setEnabled(settings.global_hotkeys_enabled ?? false);
    } catch (err: unknown) {
      console.warn('Failed to read global hotkey state:', err);
    }
  };

  onSettled(() => {
    void refresh();
  });

  // Acknowledge a hotkey firing while the window is open, so the binding is
  // visibly working even when its action isn't a visible window change.
  onSettled(() => {
    if (!isTauri) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void listen<string>('global-hotkey', (event) => {
      const label = ACTION_LABELS[event.payload as GlobalHotkeyAction] ?? event.payload;
      toast.info(`Global hotkey: ${label}`);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  });

  const handleToggleEnabled = async (next: boolean) => {
    setEnabled(next);
    if (!isTauri) {
      toast.info('[Web Preview] Global hotkeys need the desktop build');
      return;
    }
    setBusy(true);
    try {
      await commands.setGlobalHotkeysEnabled(next);
      await refresh();
      toast.success(next ? 'Global hotkeys enabled' : 'Global hotkeys disabled');
      props.onStatusChange?.(next ? 'Global hotkeys enabled' : 'Global hotkeys disabled');
    } catch (err: unknown) {
      setEnabled(!next);
      toast.error(`Failed to update global hotkeys: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleBind = async (action: GlobalHotkeyAction, spec: string) => {
    setBusy(true);
    try {
      await commands.setGlobalHotkey(action, spec);
      await refresh();
      toast.success(spec === '' ? 'Global hotkey cleared' : 'Global hotkey saved');
    } catch (err: unknown) {
      // The backend rejects unparseable specs and cross-action conflicts with a
      // message written for display, so surface it verbatim.
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  };

  const specFor = (action: GlobalHotkeyAction): string =>
    bindings().find((binding) => binding.action === action)?.spec ?? '';

  /**
   * Explains the listener state in one line, or null when it's simply idle.
   *
   * A memo rather than a plain function because the JSX below reads it three
   * times (guard, tone, text); as a function each read re-ran the whole
   * derivation, and each needed a non-null assertion to re-narrow what the
   * guard had already established.
   */
  const statusLine = createMemo((): { text: string; tone: 'ok' | 'warn' | 'error' } | null => {
    const current = status();
    if (!current) return null;
    if (current.error) return { text: current.error, tone: 'error' };
    if (!enabled()) return null;
    if (!current.active) {
      return { text: 'No global hotkeys bound yet — record one below.', tone: 'warn' };
    }
    return {
      text: current.blocking
        ? `Listening — ${current.registered} bound. Matched shortcuts are withheld from other apps.`
        : `Listening — ${current.registered} bound. Detect-only: matched shortcuts still reach the focused app.`,
      tone: current.blocking ? 'ok' : 'warn',
    };
  });

  // macOS gates keyboard taps behind an explicit Accessibility grant; the button
  // opens the exact settings pane rather than describing where to find it.
  createEffect(
    () => status()?.needs_accessibility ?? false,
    (needsPermission) => {
      if (needsPermission) {
        props.onStatusChange?.('Global hotkeys need Accessibility permission');
      }
    }
  );

  return (
    <div class="dev-section">
      <div class="dev-section-header">
        <Command size={16} color="var(--accent-cyan)" />
        <span class="dev-section-title">Global Hotkeys (system-wide)</span>
      </div>
      <p class="dev-section-desc">
        Handled by the native backend's OS keyboard hook, so these fire from anywhere — even while
        the app is hidden in the tray. The shortcuts in the cheat sheet ({IS_MAC ? '⌘/' : 'Ctrl+/'})
        only work while this window has focus.
      </p>

      {!isTauri ? (
        <div class="global-hotkey-note">
          Global hotkeys install a system keyboard hook and are only available in the desktop build.
        </div>
      ) : (
        <>
          <ToggleSwitch
            icon={<Shield size={18} />}
            title="Enable global hotkeys"
            subtitle="Installs a system-wide keyboard hook. Off by default — turn it on only if you want app shortcuts to work while other windows are focused."
            checked={enabled}
            disabled={busy()}
            ariaLabel="Enable global hotkeys"
            onToggle={(next) => void handleToggleEnabled(next)}
          />

          <Show when={statusLine()}>
            {(line) => (
              <div
                class={`global-hotkey-status tone-${line().tone}`}
                role="status"
                aria-live="polite"
              >
                {line().tone === 'ok' ? <Shield size={12} /> : <AlertTriangle size={12} />}
                <span>{line().text}</span>
              </div>
            )}
          </Show>

          {status()?.needs_accessibility && (
            <div class="global-hotkey-permission" role="alert">
              <span>
                macOS requires Accessibility permission before an app may observe the keyboard.
              </span>
              <button
                type="button"
                class="btn-update-secondary"
                onClick={() => {
                  void commands
                    .openAccessibilitySettings()
                    .then(() => toast.info('Grant access, then relaunch the app'))
                    .catch((err: unknown) => toast.error(String(err)));
                }}
              >
                <span>Open Accessibility Settings</span>
              </button>
            </div>
          )}

          <div class="global-hotkey-list">
            <For each={ACTION_ORDER}>
              {(action) => (
                <div class="shortcut-row">
                  <span class="shortcut-desc">{ACTION_LABELS[action]}</span>
                  <HotkeyRecorder
                    ariaLabel={`Bind global hotkey: ${ACTION_LABELS[action]}`}
                    spec={() => specFor(action)}
                    canReset={() => specFor(action) !== ''}
                    onRecord={(spec) => void handleBind(action, spec)}
                    onReset={() => void handleBind(action, '')}
                  />
                </div>
              )}
            </For>
          </div>

          <div class="dev-quick-actions">
            <button
              type="button"
              class="btn-update-secondary"
              onClick={() => void refresh()}
              disabled={busy()}
              title="Re-read the listener status from the backend"
            >
              <RefreshCw size={13} class={busy() ? 'spin-icon' : ''} />
              <span>Refresh Status</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};
