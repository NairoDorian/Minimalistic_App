import { createSignal, onSettled, untrack, type Component } from 'solid-js';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  sendNotification,
  isPermissionGranted,
  requestPermission,
} from '@tauri-apps/plugin-notification';
import {
  RefreshCw,
  Download,
  CheckCircle2,
  AlertCircle,
  FileText,
  ChevronDown,
  ChevronUp,
} from '../lib/icons';
import { isTauri } from '../lib/tauri';

interface UpdateCheckerProps {
  autoCheckOnMount?: () => boolean;
  listenForEvents?: () => boolean;
  onStatusChange?: (status: string) => void;
  variant?: 'card' | 'footer';
}

/**
 * Module-level install guard shared by every UpdateChecker instance.
 * Prevents concurrent download-and-install cycles.
 */
let installInFlight = false;

/**
 * Surfaces a native OS notification when a new version is found while the
 * main window is hidden in the tray — the only channel that can reach the
 * user without opening the GUI.
 */
const notifyIfHidden = async (version: string) => {
  if (!isTauri) return;
  try {
    const visible = await getCurrentWindow().isVisible();
    if (visible) return;

    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    if (granted) {
      sendNotification({
        title: 'Update available',
        body: `v${version} is ready to install. Open the app to update.`,
      });
    }
  } catch (err: unknown) {
    console.warn('Failed to send update notification:', err);
  }
};

export const UpdateChecker: Component<UpdateCheckerProps> = (props) => {
  const [isChecking, setIsChecking] = createSignal<boolean>(false);
  const [updateAvailable, setUpdateAvailable] = createSignal<boolean>(false);
  const [isInstalling, setIsInstalling] = createSignal<boolean>(false);
  const [downloadProgress, setDownloadProgress] = createSignal<number>(0);
  const [showUpToDate, setShowUpToDate] = createSignal<boolean>(false);
  const [latestVersion, setLatestVersion] = createSignal<string | null>(null);
  const [releaseNotes, setReleaseNotes] = createSignal<string | null>(null);
  const [showNotes, setShowNotes] = createSignal<boolean>(false);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

  // Mutable scratch state (not signals — these are concurrency guards and
  // caches that must not trigger reactivity on every read).
  let pendingUpdate: Update | null = null;
  let upToDateTimeout: ReturnType<typeof setTimeout> | null = null;
  let isCheckingGuard = false;
  let isInstallingGuard = false;

  /** Checks GitHub Releases for a newer version. */
  const checkForUpdates = async (isManual = false) => {
    if (!isTauri || isCheckingGuard || isInstallingGuard) return;

    isCheckingGuard = true;
    setIsChecking(true);
    setErrorMessage(null);
    props.onStatusChange?.('Checking for updates...');

    try {
      const update = await check();

      if (update?.available) {
        pendingUpdate = update;
        setLatestVersion(update.version);
        setReleaseNotes(update.body || null);
        setUpdateAvailable(true);
        setShowUpToDate(false);
        setShowNotes(false);
        props.onStatusChange?.(`New version v${update.version} available!`);
        void notifyIfHidden(update.version);
      } else {
        pendingUpdate = null;
        setUpdateAvailable(false);
        setReleaseNotes(null);
        setShowNotes(false);

        if (isManual) {
          setShowUpToDate(true);
          props.onStatusChange?.('Application is up to date');
          if (upToDateTimeout) clearTimeout(upToDateTimeout);
          upToDateTimeout = setTimeout(() => {
            setShowUpToDate(false);
            upToDateTimeout = null;
          }, 4000);
        } else {
          props.onStatusChange?.('Up to date');
        }
      }
    } catch (error: unknown) {
      console.error('Failed to check for updates:', error);
      pendingUpdate = null;
      const errStr = error instanceof Error ? error.message : String(error);
      if (errStr.includes('404') || errStr.includes('Could not fetch')) {
        setErrorMessage('Update endpoint not found (GitHub release pending)');
      } else {
        setErrorMessage('Unable to connect to update server');
      }
      props.onStatusChange?.('Update check failed');
    } finally {
      isCheckingGuard = false;
      setIsChecking(false);
    }
  };

  /**
   * One-time owned setup: optional auto-check, optional tray-event listener,
   * and the matching teardown — the SolidJS 2 lifecycle shape (`onSettled`
   * returning a cleanup).
   *
   * Both props are read once, through `untrack`, and deliberately so. As a
   * re-running `createEffect` this fired a fresh update check every time
   * `autoCheckOnMount` flipped — so merely switching the "check for updates on
   * launch" preference on triggered an immediate network check and tore down
   * and re-registered the tray listener. Neither prop describes a value that
   * should be re-observed; they describe what this instance does when it
   * mounts, and the caller controls that by choosing when to mount it.
   */
  onSettled(() => {
    if (!isTauri) return;

    let isCancelled = false;
    let unlistenFn: (() => void) | undefined;

    if (untrack(() => props.autoCheckOnMount?.() ?? true)) {
      void checkForUpdates(false);
    }

    if (untrack(() => props.listenForEvents?.() ?? true)) {
      void listen('check-for-updates', () => {
        if (!isCancelled) void checkForUpdates(true);
      })
        .then((fn) => {
          if (isCancelled) fn();
          else unlistenFn = fn;
        })
        .catch(() => {});
    }

    return () => {
      isCancelled = true;
      if (upToDateTimeout) {
        clearTimeout(upToDateTimeout);
        upToDateTimeout = null;
      }
      unlistenFn?.();
    };
  });

  /**
   * Downloads and installs the pending update, then relaunches the app.
   * Uses optimistic UI: sets isInstalling immediately and rolls back on failure.
   */
  const installUpdate = async () => {
    if (!isTauri || isInstallingGuard || installInFlight) return;

    installInFlight = true;
    isInstallingGuard = true;
    setIsInstalling(true);
    setDownloadProgress(0);
    setErrorMessage(null);
    props.onStatusChange?.('Starting update download...');

    try {
      let update = pendingUpdate;
      if (!update) {
        update = await check();
      }

      if (!update?.available) {
        props.onStatusChange?.('No update found to install');
        return;
      }

      pendingUpdate = update;
      setLatestVersion(update.version);
      setReleaseNotes(update.body || null);
      setUpdateAvailable(true);
      setShowUpToDate(false);
      setShowNotes(false);

      let downloadedBytes = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            downloadedBytes = 0;
            contentLength = event.data.contentLength ?? 0;
            break;
          case 'Progress':
            downloadedBytes += event.data.chunkLength;
            if (contentLength > 0) {
              const pct = Math.min(
                Math.max(Math.round((downloadedBytes / contentLength) * 100), 0),
                100
              );
              setDownloadProgress(pct);
              props.onStatusChange?.(`Downloading update... ${pct}%`);
            } else {
              props.onStatusChange?.('Downloading binary...');
            }
            break;
          case 'Finished':
            props.onStatusChange?.('Download complete. Applying update...');
            break;
        }
      });

      props.onStatusChange?.('Relaunching application...');
      await relaunch();
    } catch (error: unknown) {
      console.error('Failed to install update:', error);
      const errMsg = error instanceof Error ? error.message : String(error);
      setErrorMessage('Installation failed: ' + errMsg);
      props.onStatusChange?.('Update installation failed');
    } finally {
      installInFlight = false;
      isInstallingGuard = false;
      setIsInstalling(false);
      setDownloadProgress(0);
    }
  };

  if (props.variant === 'footer') {
    return (
      <div class="update-checker-footer" aria-live="polite">
        {isChecking() && (
          <span class="update-status-label">
            <RefreshCw size={12} class="spin-icon" /> Checking updates...
          </span>
        )}
        {showUpToDate() && (
          <span class="update-status-label text-success">
            <CheckCircle2 size={12} /> App is up to date
          </span>
        )}
        {errorMessage() && (
          <span class="update-status-label text-error">
            <AlertCircle size={12} /> {errorMessage()}
          </span>
        )}
        {updateAvailable() && !isInstalling() && (
          <button onClick={() => void installUpdate()} class="btn-update-footer">
            <Download size={12} /> Update to v{latestVersion()}
          </button>
        )}
        {isInstalling() && (
          <span class="update-status-label text-accent">
            <Download size={12} class="bounce-icon" /> Installing ({downloadProgress()}%)
          </span>
        )}
        {!isChecking() && !showUpToDate() && !updateAvailable() && !isInstalling() && (
          <button
            onClick={() => void checkForUpdates(true)}
            class="btn-footer-check"
            aria-label="Check for updates"
          >
            <RefreshCw size={12} /> Check Updates
          </button>
        )}
      </div>
    );
  }

  return (
    <div class="update-checker-card">
      <div class="setting-item">
        <div class="setting-info">
          <div class={`setting-icon ${updateAvailable() ? 'highlight' : ''}`}>
            {isChecking() ? (
              <RefreshCw size={18} class="spin-icon" />
            ) : updateAvailable() ? (
              <Download size={18} color="var(--accent-cyan)" />
            ) : showUpToDate() ? (
              <CheckCircle2 size={18} color="#10b981" />
            ) : (
              <RefreshCw size={18} />
            )}
          </div>
          <div class="setting-text">
            <span class="setting-title">Software Updates</span>
            <span class="setting-subtitle">
              {isChecking()
                ? 'Checking GitHub releases for newer version...'
                : isInstalling()
                  ? `Downloading update binary (${downloadProgress()}%)...`
                  : updateAvailable()
                    ? `New update v${latestVersion()} is ready to install!`
                    : showUpToDate()
                      ? 'Your app is currently running the latest version.'
                      : 'Check for new releases, bug fixes, and feature updates.'}
            </span>
          </div>
        </div>

        <div class="update-actions">
          {updateAvailable() && !isInstalling() && (
            <>
              {releaseNotes() && (
                <button
                  onClick={() => setShowNotes((prev) => !prev)}
                  class="btn-update-secondary"
                  aria-label="Toggle release notes"
                  aria-expanded={showNotes() ? 'true' : 'false'}
                >
                  <FileText size={14} />
                  {showNotes() ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
              )}
              <button onClick={() => void installUpdate()} class="btn-update-primary">
                <Download size={14} /> Install v{latestVersion()}
              </button>
            </>
          )}

          {!updateAvailable() && !isInstalling() && (
            <button
              onClick={() => void checkForUpdates(true)}
              disabled={isChecking()}
              class="btn-update-secondary"
            >
              <RefreshCw size={14} class={isChecking() ? 'spin-icon' : ''} />
              {isChecking() ? 'Checking...' : showUpToDate() ? 'Up to Date' : 'Check for Updates'}
            </button>
          )}

          {isInstalling() && (
            <div class="install-badge">
              <span>{downloadProgress()}%</span>
            </div>
          )}
        </div>
      </div>

      {updateAvailable() && releaseNotes() && showNotes() && (
        <div class="release-notes-box">
          <span class="release-notes-heading">Release Notes for v{latestVersion()}:</span>
          <pre class="release-notes-content">{releaseNotes()}</pre>
        </div>
      )}

      {isInstalling() && (
        <div class="update-progress-container">
          <div
            class="update-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={downloadProgress()}
            aria-label="Update download progress"
          >
            <div
              class="update-progress-fill"
              style={{ width: `${Math.max(downloadProgress(), 5)}%` }}
            ></div>
          </div>
        </div>
      )}

      {errorMessage() && (
        <div class="update-error-banner" role="alert">
          <AlertCircle size={14} />
          <span>{errorMessage()}</span>
        </div>
      )}
    </div>
  );
};
