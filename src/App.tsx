import { createSignal, createEffect, onCleanup, onSettled, For } from 'solid-js';
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
import { applyThemeAccent } from './lib/theme';

export type TabType = 'preferences' | 'about' | 'developer';

const TAB_ORDER: readonly TabType[] = ['preferences', 'about', 'developer'];

const ACTIVE_TAB_KEY = 'minimalistic_app.active_tab';

function loadInitialTab(): TabType {
  const saved = localStorage.getItem(ACTIVE_TAB_KEY);
  if (TAB_ORDER.includes(saved as TabType)) return saved as TabType;
  return 'preferences';
}

const TABS: readonly { id: TabType; label: string; icon: LucideIcon }[] = [
  { id: 'preferences', label: 'Preferences', icon: Settings },
  { id: 'about', label: 'System & About', icon: Info },
  { id: 'developer', label: 'Developer Hub', icon: Code2 },
];

export function AppContent() {
  const [activeTab, setActiveTab] = createSignal<TabType>(loadInitialTab);
  const [statusMessage, setStatusMessage] = createSignal<string>('Ready');
  const [appInfo, setAppInfo] = createSignal<AppInfo | null>(null);
  const [shortcutsModalOpen, setShortcutsModalOpen] = createSignal<boolean>(false);

  let statusTimeout: ReturnType<typeof setTimeout> | null = null;

  onCleanup(() => {
    if (statusTimeout) clearTimeout(statusTimeout);
  });

  // Persist the active tab so the app reopens on the same view it was closed on.
  createEffect(
    () => activeTab(),
    (tab) => {
      localStorage.setItem(ACTIVE_TAB_KEY, tab);
    }
  );

  // Load app metadata on mount (one-time, not reactive).
  onSettled(() => {
    if (!isTauri) {
      setAppInfo(WEB_PREVIEW_APP_INFO);
      return;
    }

    commands
      .getAppInfo()
      .then(setAppInfo)
      .catch((err: unknown) => {
        console.warn('App info IPC query failed:', err);
      });
  });

  /** Sets a temporary status message that auto-clears to 'Ready' after 4 seconds. */
  const updateStatus = (msg: string) => {
    setStatusMessage(msg);
    if (statusTimeout) clearTimeout(statusTimeout);
    statusTimeout = setTimeout(() => setStatusMessage('Ready'), 4000);
  };

  // Global keyboard shortcuts listener (Ctrl/Cmd + number, ?, Ctrl+/, Cmd+,)
  onSettled(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (mod && e.key === '1') {
        e.preventDefault();
        setActiveTab('preferences');
      } else if (mod && e.key === '2') {
        e.preventDefault();
        setActiveTab('about');
      } else if (mod && e.key === '3') {
        e.preventDefault();
        setActiveTab('developer');
      } else if (mod && e.key === ',') {
        e.preventDefault();
        setActiveTab('preferences');
      } else if (
        (mod && e.key === '/') ||
        (!mod &&
          e.key === '?' &&
          !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement))
      ) {
        e.preventDefault();
        setShortcutsModalOpen((prev) => !prev);
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
    applyThemeAccent('cyan');
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
          <span class="brand-title">Minimalistic App</span>
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
          <span>Status: {statusMessage()}</span>
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
      <AppContent />
    </ErrorBoundary>
  );
}
