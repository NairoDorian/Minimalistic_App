import { createSignal, createEffect, createMemo, isPending, onCleanup, onSettled, For } from 'solid-js';
import { Loading } from '@solidjs/web';
import { Settings, Info, AppWindow, Shield, Code2, type LucideIcon } from './lib/icons';
import { commands } from './bindings';
import type { AppInfo } from './bindings';
import { PreferencesTab } from './components/PreferencesTab';
import { AboutTab, WEB_PREVIEW_APP_INFO } from './components/AboutTab';
import { DeveloperTab } from './components/DeveloperTab';
import { UpdateChecker } from './components/UpdateChecker';
import { ToastContainer } from './components/Toast';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isTauri } from './lib/tauri';
import { applyThemeAccent, DEFAULT_THEME_ACCENT } from './lib/theme';
import { resolveShortcutAction } from './lib/shortcuts';
import { isCapturingHotkey } from './lib/keyboard';
import { APP_NAME, storageKey } from './lib/appMeta';

export type TabType = 'preferences' | 'about' | 'developer';

const TABS: readonly { id: TabType; label: string; icon: LucideIcon }[] = [
  { id: 'preferences', label: 'Preferences', icon: Settings },
  { id: 'about', label: 'System & About', icon: Info },
  { id: 'developer', label: 'Developer Hub', icon: Code2 },
];

/** Tab ids in render order — derived from TABS so the two can never drift. */
const TAB_ORDER: readonly TabType[] = TABS.map((tab) => tab.id);

const ACTIVE_TAB_KEY = storageKey('active_tab');

/**
 * localStorage can throw (private mode, disabled storage, quota). The persisted
 * tab is a convenience, never a correctness requirement, so failures degrade to
 * the default tab instead of crashing the app into the error boundary.
 */
function loadInitialTab(): TabType {
  try {
    const saved = localStorage.getItem(ACTIVE_TAB_KEY);
    if (TAB_ORDER.includes(saved as TabType)) return saved as TabType;
  } catch {
    /* storage unavailable — fall through to the default */
  }
  return 'preferences';
}

/** Elements that own their keystrokes — un-modified shortcuts must not steal them. */
function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function AppContent() {
  const [activeTab, setActiveTab] = createSignal<TabType>(loadInitialTab);
  const [statusMessage, setStatusMessage] = createSignal<string>('Ready');
  const [shortcutsModalOpen, setShortcutsModalOpen] = createSignal<boolean>(false);

  let statusTimeout: ReturnType<typeof setTimeout> | null = null;

  onCleanup(() => {
    if (statusTimeout) clearTimeout(statusTimeout);
  });

  // Persist the active tab so the app reopens on the same view it was closed on.
  createEffect(
    () => activeTab(),
    (tab) => {
      try {
        localStorage.setItem(ACTIVE_TAB_KEY, tab);
      } catch {
        /* storage unavailable — the tab simply won't be restored next launch */
      }
    }
  );

  /**
   * Application metadata as a SolidJS 2 async memo — "async lives in the graph".
   *
   * The memo wraps the IPC round-trip (with exponential-backoff retries for the
   * startup IPC race) so consumers read `appInfo()` as a plain accessor. While the
   * promise is in flight, `isPending(appInfo)` is true and any read without a
   * `<Loading>` ancestor reports "not ready". After it settles, stale content
   * stays visible during revalidation (none here — it's a one-shot load).
   *
   * In the browser preview the memo resolves synchronously to the stub info,
   * so no `<Loading>` boundary is ever observed.
   */
  const appInfo = createMemo(async (): Promise<AppInfo> => {
    if (!isTauri) return WEB_PREVIEW_APP_INFO;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // Intentionally sequential — each retry must wait for the previous
        // attempt to fail before backing off and trying again.
        // eslint-disable-next-line no-await-in-loop
        return await commands.getAppInfo();
      } catch (err: unknown) {
        if (attempt >= 3) {
          console.warn('App info IPC query failed after retries:', err);
          return WEB_PREVIEW_APP_INFO;
        }
        // Exponential backoff before the next attempt — same regime as the
        // settings loader in PreferencesTab. Must await sequentially so the
        // delay precedes the retry.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
      }
    }
    // Unreachable, but satisfies the control-flow exhaustiveness for TS.
    return WEB_PREVIEW_APP_INFO;
  });

  /** Sets a temporary status message that auto-clears to 'Ready' after 4 seconds. */
  const updateStatus = (msg: string) => {
    setStatusMessage(msg);
    if (statusTimeout) clearTimeout(statusTimeout);
    statusTimeout = setTimeout(() => setStatusMessage('Ready'), 4000);
  };

  // Global keyboard shortcuts, dispatched from the APP_SHORTCUTS registry so the
  // cheat-sheet modal always documents exactly what the app listens for.
  onSettled(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // A hotkey recorder is armed — the chord being bound must not also fire
      // whatever it is currently bound to.
      if (isCapturingHotkey()) return;

      const action = resolveShortcutAction(e);
      // `Escape` is owned by whichever modal is open (see KeyboardShortcutsModal).
      if (action === null || action === 'close-modal') return;

      // Un-modified shortcuts (e.g. `?`) must never steal keystrokes from a field.
      const isUnmodified = !e.ctrlKey && !e.metaKey;
      if (isUnmodified && isTextEntryTarget(e.target)) return;

      e.preventDefault();
      switch (action) {
        case 'tab-preferences':
          setActiveTab('preferences');
          break;
        case 'tab-about':
          setActiveTab('about');
          break;
        case 'tab-developer':
          setActiveTab('developer');
          break;
        case 'toggle-shortcuts':
          setShortcutsModalOpen((prev) => !prev);
          break;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  });

  /** Arrow / Home / End navigation between tabs — follows ARIA roving-tabindex. */
  const handleTabKeyDown = (e: KeyboardEvent, tab: TabType) => {
    const index = TAB_ORDER.indexOf(tab);
    let next: TabType | null = null;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        next = TAB_ORDER[(index + 1) % TAB_ORDER.length] ?? null;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        next = TAB_ORDER[(index - 1 + TAB_ORDER.length) % TAB_ORDER.length] ?? null;
        break;
      case 'Home':
        e.preventDefault();
        next = TAB_ORDER[0] ?? null;
        break;
      case 'End':
        e.preventDefault();
        next = TAB_ORDER[TAB_ORDER.length - 1] ?? null;
        break;
      default:
        return;
    }

    if (next === null) return;
    setActiveTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  const handleSettingsReset = () => {
    applyThemeAccent(DEFAULT_THEME_ACCENT);
    updateStatus('Settings reset to defaults');
  };

  return (
    <div class="app-container">
      <ToastContainer />
      <KeyboardShortcutsModal
        isOpen={shortcutsModalOpen}
        onClose={() => setShortcutsModalOpen(false)}
      />

      <header class="app-header" data-tauri-drag-region>
        <div class="brand-section" data-tauri-drag-region>
          <div class="brand-icon">
            <AppWindow size={18} />
          </div>
          <span class="brand-title">{APP_NAME}</span>
        </div>
        <div class={`tray-status-badge ${isTauri ? 'tray-active' : 'web-preview'}`}>
          <span class="status-dot"></span>
          <span>{isTauri ? 'System Tray Active' : 'Web Preview'}</span>
        </div>
      </header>

      <main class="app-content">
        <nav class="navigation-tab" role="tablist" aria-label="Main Navigation">
          <For each={TABS} keyed>
            {(tab) => {
              const Icon = tab.icon;
              return (
                <button
                  id={`tab-${tab.id}`}
                  type="button"
                  class={`tab-btn ${activeTab() === tab.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
                  aria-selected={activeTab() === tab.id ? 'true' : 'false'}
                  aria-controls={`panel-${tab.id}`}
                  role="tab"
                  tabindex={activeTab() === tab.id ? 0 : -1}
                >
                  <Icon size={14} />
                  <span>{tab.label}</span>
                </button>
              );
            }}
          </For>
        </nav>

        <div class="app-content-tabs">
          {activeTab() === 'preferences' && <PreferencesTab onStatusChange={updateStatus} />}
          {activeTab() === 'about' && (
            <AboutTab
              appInfo={appInfo}
              onStatusChange={updateStatus}
              onOpenShortcuts={() => setShortcutsModalOpen(true)}
            />
          )}
          {activeTab() === 'developer' && (
            <DeveloperTab onStatusChange={updateStatus} onSettingsReset={handleSettingsReset} />
          )}
        </div>
      </main>

      <footer class="app-footer">
        <div class="footer-status" aria-live="polite">
          <Shield size={12} color="var(--accent-cyan)" />
          {/* isPending surfaces the in-flight state of the app-info async memo —
              true while the startup IPC round-trip is outstanding, false once it
              settles. Shows a loading hint instead of the static "Ready". */}
          <span>Status: {isPending(appInfo) ? 'Loading system info...' : statusMessage()}</span>
        </div>
        <UpdateChecker
          variant="footer"
          autoCheckOnMount={() => false}
          listenForEvents={() => false}
        />
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      {/* App-level Loading boundary: absorbs the appInfo async memo's initial
          IPC round-trip (and any future revalidation). In the browser preview
          the memo resolves synchronously so this never shows a fallback. */}
      <Loading fallback={<AppSkeleton />}>
        <AppContent />
      </Loading>
    </ErrorBoundary>
  );
}

/** Skeleton rendered while the root app data is still mounting. */
function AppSkeleton() {
  return (
    <div class="app-container">
      <header class="app-header" data-tauri-drag-region>
        <div class="brand-section" data-tauri-drag-region>
          <div class="brand-icon">
            <AppWindow size={18} />
          </div>
          <span class="brand-title">{APP_NAME}</span>
        </div>
        <div class={`tray-status-badge ${isTauri ? 'tray-active' : 'web-preview'}`}>
          <span class="status-dot"></span>
          <span>{isTauri ? 'System Tray Active' : 'Web Preview'}</span>
        </div>
      </header>
      <main class="app-content">
        <nav class="navigation-tab" role="tablist" aria-label="Main Navigation">
          <For each={TABS} keyed>
            {(tab) => {
              const Icon = tab.icon;
              return (
                <button
                  type="button"
                  class="tab-btn"
                  role="tab"
                  tabindex={-1}
                  aria-selected={tab.id === 'preferences' ? 'true' : 'false'}
                >
                  <Icon size={14} />
                  <span>{tab.label}</span>
                </button>
              );
            }}
          </For>
        </nav>
        <div class="app-content-tabs">
          <div class="settings-card" role="tabpanel" tabindex={0}>
            <div class="settings-card-header">
              <h2 class="settings-card-title">Loading…</h2>
              <p class="settings-card-desc">Initializing application metadata…</p>
            </div>
          </div>
        </div>
      </main>
      <footer class="app-footer">
        <div class="footer-status" aria-live="polite">
          <Shield size={12} color="var(--accent-cyan)" />
          <span>Status: Loading…</span>
        </div>
      </footer>
    </div>
  );
}
