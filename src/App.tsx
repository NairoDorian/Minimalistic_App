import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Settings, Info, AppWindow, Shield, type LucideIcon } from "lucide-react";
import { PreferencesTab } from "./components/PreferencesTab";
import { AboutTab, type AppInfo, WEB_PREVIEW_APP_INFO } from "./components/AboutTab";
import { UpdateChecker } from "./components/UpdateChecker";
import { isTauri } from "./lib/tauri";

type TabType = "preferences" | "about";

/** Tab order used for roving-tabindex keyboard navigation (Home / End). */
const TAB_ORDER: readonly TabType[] = ["preferences", "about"];

/**
 * Single source of truth for the tab bar: id (drives DOM ids + state), label,
 * and icon. Rendered data-driven below so the two tab buttons can never drift
 * from each other in markup or accessibility attributes.
 */
const TABS: readonly { id: TabType; label: string; icon: LucideIcon }[] = [
  { id: "preferences", label: "Preferences", icon: Settings },
  { id: "about", label: "System & About", icon: Info },
];

/**
 * Main Application GUI Component (React 19) — the application shell.
 *
 * Responsibilities:
 * 1. Modular Tab Navigation (Preferences, System Info & About) with full
 *    WAI-ARIA tabs keyboard pattern (arrows + Home / End, roving tabIndex).
 * 2. Loads app/runtime metadata via IPC (passes it to <AboutTab/>).
 * 3. Shared footer status message with auto-clear, fed by tab components
 *    via `onStatusChange` and by the footer's compact UpdateChecker.
 * 4. Native Window Drag Region (`data-tauri-drag-region`).
 *
 * The two tab panels live in their own components:
 * - `PreferencesTab` — owns the autostart / minimize-to-tray toggles.
 * - `AboutTab`      — purely presentational metadata view.
 */
export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>("preferences");
  const [statusMessage, setStatusMessage] = useState<string>("Ready");
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  // Timeout handle for the auto-clearing footer status message.
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending status auto-clear timer on unmount.
  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    };
  }, []);

  // Load platform metadata asynchronously (browser preview falls back to
  // WEB_PREVIEW_APP_INFO). StrictMode dev double-mounting is harmless — the
  // IPC read is idempotent.
  useEffect(() => {
    if (!isTauri) {
      setAppInfo(WEB_PREVIEW_APP_INFO);
      return;
    }

    invoke<AppInfo>("get_app_info")
      .then(setAppInfo)
      .catch((err: unknown) => {
        console.warn("App info IPC query failed:", err);
      });
  }, []);

  /**
   * Helper to set the footer status message with an auto-clear timeout.
   * Resets the countdown on every call so rapid updates don't flicker early.
   */
  const updateStatus = useCallback((msg: string) => {
    setStatusMessage(msg);
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    statusTimeoutRef.current = setTimeout(() => setStatusMessage("Ready"), 4000);
  }, []);

  /**
   * Roving-tabindex keyboard navigation for the tablist (complete WAI-ARIA
   * tabs pattern): ArrowLeft / ArrowRight cycle tabs, Home / End jump to the
   * first / last tab. Focus moves to the newly active tab.
   */
  const handleTabKeyDown = useCallback((e: KeyboardEvent<HTMLButtonElement>, tab: TabType) => {
    const index = TAB_ORDER.indexOf(tab);
    let next: TabType | null = null;

    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        next = TAB_ORDER[(index + 1) % TAB_ORDER.length];
        break;
      case "ArrowLeft":
        e.preventDefault();
        next = TAB_ORDER[(index - 1 + TAB_ORDER.length) % TAB_ORDER.length];
        break;
      case "Home":
        e.preventDefault();
        next = TAB_ORDER[0];
        break;
      case "End":
        e.preventDefault();
        next = TAB_ORDER[TAB_ORDER.length - 1];
        break;
      default:
        return;
    }

    setActiveTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  }, []);

  return (
    <div className="app-container">
      {/* Sleek Native Window Header Bar with data-tauri-drag-region */}
      <header className="app-header" data-tauri-drag-region>
        <div className="brand-section" data-tauri-drag-region>
          <div className="brand-icon">
            <AppWindow size={18} />
          </div>
          <span className="brand-title">Minimalistic App</span>
        </div>
        <div className="tray-status-badge">
          <span className="status-dot"></span>
          <span>System Tray Active</span>
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
              className={`tab-btn ${activeTab === id ? "active" : ""}`}
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

        {/* Active Tab Panel (ternary so the inactive panel unmounts) */}
        {activeTab === "preferences" ? (
          <PreferencesTab onStatusChange={updateStatus} />
        ) : (
          <AboutTab appInfo={appInfo} />
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
