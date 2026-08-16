import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Settings, Info, AppWindow, Shield, Code2, type LucideIcon } from 'lucide-react';
import { PreferencesTab } from './components/PreferencesTab';
import { AboutTab, type AppInfo, WEB_PREVIEW_APP_INFO } from './components/AboutTab';
import { DeveloperTab } from './components/DeveloperTab';
import { UpdateChecker } from './components/UpdateChecker';
import { ToastContainer } from './components/Toast';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isTauri } from './lib/tauri';
import { applyThemeAccent, type ThemeAccent } from './lib/theme';

type TabType = 'preferences' | 'about' | 'developer';

const TAB_ORDER: readonly TabType[] = ['preferences', 'about', 'developer'];

const TABS: readonly { id: TabType; label: string; icon: LucideIcon }[] = [
  { id: 'preferences', label: 'Preferences', icon: Settings },
  { id: 'about', label: 'System & About', icon: Info },
  { id: 'developer', label: 'Developer Hub', icon: Code2 },
];

export function AppContent() {
  const [activeTab, setActiveTab] = useState<TabType>('preferences');
  const [statusMessage, setStatusMessage] = useState<string>('Ready');
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState<boolean>(false);

  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isTauri) {
      setAppInfo(WEB_PREVIEW_APP_INFO);
      return;
    }

    invoke<AppInfo>('get_app_info')
      .then(setAppInfo)
      .catch((err: unknown) => {
        console.warn('App info IPC query failed:', err);
      });
  }, []);

  const updateStatus = useCallback((msg: string) => {
    setStatusMessage(msg);
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    statusTimeoutRef.current = setTimeout(() => setStatusMessage('Ready'), 4000);
  }, []);

  // Global Keyboard Shortcuts Listener
  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
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
  }, []);

  const handleTabKeyDown = useCallback((e: KeyboardEvent<HTMLButtonElement>, tab: TabType) => {
    const index = TAB_ORDER.indexOf(tab);
    let next: TabType | null = null;

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        next = TAB_ORDER[(index + 1) % TAB_ORDER.length] ?? null;
        break;
      case 'ArrowLeft':
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
  }, []);

  const handleSettingsReset = useCallback(() => {
    applyThemeAccent('cyan');
    updateStatus('Settings reset to defaults');
  }, [updateStatus]);

  return (
    <div className="app-container">
      {/* Toast Notification Container */}
      <ToastContainer />

      {/* Keyboard Shortcuts Cheat Sheet Modal */}
      <KeyboardShortcutsModal
        isOpen={shortcutsModalOpen}
        onClose={() => setShortcutsModalOpen(false)}
      />

      {/* Native Window Header Bar */}
      <header className="app-header" data-tauri-drag-region>
        <div className="brand-section" data-tauri-drag-region>
          <div className="brand-icon">
            <AppWindow size={18} />
          </div>
          <span className="brand-title">Minimalistic App</span>
        </div>
        <div className={`tray-status-badge ${isTauri ? 'tray-active' : 'web-preview'}`}>
          <span className="status-dot"></span>
          <span>{isTauri ? 'System Tray Active' : 'Web Preview'}</span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="app-content">
        {/* Modular Tab Navigation Header */}
        <nav className="navigation-tab" role="tablist" aria-label="Main Navigation">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              id={`tab-${id}`}
              className={`tab-btn ${activeTab === id ? 'active' : ''}`}
              onClick={() => setActiveTab(id)}
              onKeyDown={(e) => handleTabKeyDown(e, id)}
              aria-selected={activeTab === id}
              aria-controls={`panel-${id}`}
              role="tab"
              tabIndex={activeTab === id ? 0 : -1}
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {/* Active Tab Panel */}
        {activeTab === 'preferences' && (
          <PreferencesTab
            onStatusChange={updateStatus}
            onAccentChange={(_accent: ThemeAccent) => {}}
          />
        )}
        {activeTab === 'about' && (
          <AboutTab
            appInfo={appInfo}
            onStatusChange={updateStatus}
            onOpenShortcuts={() => setShortcutsModalOpen(true)}
          />
        )}
        {activeTab === 'developer' && (
          <DeveloperTab onStatusChange={updateStatus} onSettingsReset={handleSettingsReset} />
        )}
      </main>

      {/* Status Footer */}
      <footer className="app-footer">
        <div className="footer-status" aria-live="polite">
          <Shield size={12} color="var(--accent-cyan)" />
          <span>Status: {statusMessage}</span>
        </div>
        <UpdateChecker variant="footer" autoCheckOnMount={false} listenForEvents={false} />
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
