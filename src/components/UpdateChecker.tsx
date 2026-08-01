import { useState, useEffect, useRef, useCallback, type FC } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { listen } from "@tauri-apps/api/event";
import { RefreshCw, Download, CheckCircle2, AlertCircle, FileText, ChevronDown, ChevronUp } from "lucide-react";
import { isTauri } from "../lib/tauri";

interface UpdateCheckerProps {
  autoCheckOnMount?: boolean;
  listenForEvents?: boolean;
  onStatusChange?: (status: string) => void;
  variant?: "card" | "footer";
}

export const UpdateChecker: FC<UpdateCheckerProps> = ({
  autoCheckOnMount = true,
  listenForEvents = true,
  onStatusChange,
  variant = "card",
}) => {
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);
  const [isInstalling, setIsInstalling] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [showUpToDate, setShowUpToDate] = useState<boolean>(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [releaseNotes, setReleaseNotes] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pendingUpdateRef = useRef<Update | null>(null);
  const upToDateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Guard refs to prevent stale closure calls in single-mounted event listeners
  const isCheckingRef = useRef<boolean>(false);
  const isInstallingRef = useRef<boolean>(false);

  /**
   * Checks GitHub Releases for a newer version.
   */
  const checkForUpdates = useCallback(async (isManual = false) => {
    if (!isTauri || isCheckingRef.current || isInstallingRef.current) return;

    isCheckingRef.current = true;
    setIsChecking(true);
    setErrorMessage(null);
    onStatusChange?.("Checking for updates...");

    try {
      const update = await check();

      if (update?.available) {
        pendingUpdateRef.current = update;
        setLatestVersion(update.version);
        setReleaseNotes(update.body || null);
        setUpdateAvailable(true);
        setShowUpToDate(false);
        setShowNotes(false); // never leave a stale release-notes drawer open
        onStatusChange?.(`New version v${update.version} available!`);
      } else {
        pendingUpdateRef.current = null;
        setUpdateAvailable(false);
        setReleaseNotes(null);
        setShowNotes(false);

        if (isManual) {
          setShowUpToDate(true);
          onStatusChange?.("Application is up to date");
          if (upToDateTimeoutRef.current) clearTimeout(upToDateTimeoutRef.current);
          upToDateTimeoutRef.current = setTimeout(() => {
            setShowUpToDate(false);
            upToDateTimeoutRef.current = null;
          }, 4000);
        } else {
          onStatusChange?.("Up to date");
        }
      }
    } catch (error: unknown) {
      console.error("Failed to check for updates:", error);
      const errStr = error instanceof Error ? error.message : String(error);
      if (errStr.includes("404") || errStr.includes("Could not fetch")) {
        setErrorMessage("Update endpoint not found (GitHub release pending)");
      } else {
        setErrorMessage("Unable to connect to update server");
      }
      onStatusChange?.("Update check failed");
    } finally {
      isCheckingRef.current = false;
      setIsChecking(false);
    }
  }, [onStatusChange]);

  useEffect(() => {
    if (!isTauri) return;

    if (autoCheckOnMount) {
      checkForUpdates(false);
    }

    // Only the primary (card) instance responds to tray-triggered checks;
    // multiple instances listening would fire duplicate network requests.
    let unlistenPromise: Promise<() => void> | undefined;
    if (listenForEvents) {
      unlistenPromise = listen("check-for-updates", () => {
        checkForUpdates(true);
      });
    }

    return () => {
      if (upToDateTimeoutRef.current) {
        clearTimeout(upToDateTimeoutRef.current);
        upToDateTimeoutRef.current = null;
      }
      // `.catch` prevents an unhandled promise rejection if `listen` fails
      // after the component has already unmounted.
      unlistenPromise?.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [autoCheckOnMount, checkForUpdates, listenForEvents]);

  /**
   * Downloads and installs the pending update, then relaunches the app.
   */
  const installUpdate = useCallback(async () => {
    if (!isTauri || isInstallingRef.current) return;

    isInstallingRef.current = true;
    setIsInstalling(true);
    setDownloadProgress(0);
    onStatusChange?.("Starting update download...");

    try {
      let update = pendingUpdateRef.current;
      if (!update) {
        update = await check();
      }

      if (!update?.available) {
        onStatusChange?.("No update found to install");
        return;
      }

      let downloadedBytes = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            downloadedBytes = 0;
            contentLength = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloadedBytes += event.data.chunkLength;
            if (contentLength > 0) {
              const pct = Math.round((downloadedBytes / contentLength) * 100);
              setDownloadProgress(Math.min(pct, 100));
              onStatusChange?.(`Downloading update... ${pct}%`);
            } else {
              onStatusChange?.("Downloading binary...");
            }
            break;
          case "Finished":
            onStatusChange?.("Download complete. Applying update...");
            break;
        }
      });

      onStatusChange?.("Relaunching application...");
      await relaunch();
    } catch (error: unknown) {
      console.error("Failed to install update:", error);
      const errMsg = error instanceof Error ? error.message : String(error);
      setErrorMessage("Installation failed: " + errMsg);
      onStatusChange?.("Update installation failed");
    } finally {
      isInstallingRef.current = false;
      setIsInstalling(false);
      setDownloadProgress(0);
    }
  }, [onStatusChange]);

  if (variant === "footer") {
    return (
      <div className="update-checker-footer" aria-live="polite">
        {isChecking && (
          <span className="update-status-label">
            <RefreshCw size={12} className="spin-icon" /> Checking updates...
          </span>
        )}
        {showUpToDate && (
          <span className="update-status-label text-success">
            <CheckCircle2 size={12} /> App is up to date
          </span>
        )}
        {errorMessage && (
          <span className="update-status-label text-error">
            <AlertCircle size={12} /> {errorMessage}
          </span>
        )}
        {updateAvailable && !isInstalling && (
          <button onClick={installUpdate} className="btn-update-footer">
            <Download size={12} /> Update to v{latestVersion}
          </button>
        )}
        {isInstalling && (
          <span className="update-status-label text-accent">
            <Download size={12} className="bounce-icon" /> Installing ({downloadProgress}%)
          </span>
        )}
        {!isChecking && !showUpToDate && !updateAvailable && !isInstalling && (
          <button onClick={() => checkForUpdates(true)} className="btn-footer-check">
            <RefreshCw size={12} /> Check Updates
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="update-checker-card">
      <div className="setting-item">
        <div className="setting-info">
          <div className={`setting-icon ${updateAvailable ? "highlight" : ""}`}>
            {isChecking ? (
              <RefreshCw size={18} className="spin-icon" />
            ) : updateAvailable ? (
              <Download size={18} color="var(--accent-cyan)" />
            ) : showUpToDate ? (
              <CheckCircle2 size={18} color="#10b981" />
            ) : (
              <RefreshCw size={18} />
            )}
          </div>
          <div className="setting-text">
            <span className="setting-title">Software Updates</span>
            <span className="setting-subtitle">
              {isChecking
                ? "Checking GitHub releases for newer version..."
                : isInstalling
                ? `Downloading update binary (${downloadProgress}%)...`
                : updateAvailable
                ? `New update v${latestVersion} is ready to install!`
                : showUpToDate
                ? "Your app is currently running the latest version."
                : "Check for new releases, bug fixes, and feature updates."}
            </span>
          </div>
        </div>

        <div className="update-actions">
          {updateAvailable && !isInstalling && (
            <>
              {releaseNotes && (
                <button
                  onClick={() => setShowNotes(!showNotes)}
                  className="btn-update-secondary"
                  aria-label="Toggle release notes"
                  aria-expanded={showNotes}
                >
                  <FileText size={14} />
                  {showNotes ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
              )}
              <button onClick={installUpdate} className="btn-update-primary">
                <Download size={14} /> Install v{latestVersion}
              </button>
            </>
          )}

          {!updateAvailable && !isInstalling && (
            <button
              onClick={() => checkForUpdates(true)}
              disabled={isChecking}
              className="btn-update-secondary"
            >
              <RefreshCw size={14} className={isChecking ? "spin-icon" : ""} />
              {isChecking ? "Checking..." : showUpToDate ? "Up to Date" : "Check for Updates"}
            </button>
          )}

          {isInstalling && (
            <div className="install-badge">
              <span>{downloadProgress}%</span>
            </div>
          )}
        </div>
      </div>

      {/* Release Notes Drawer */}
      {updateAvailable && releaseNotes && showNotes && (
        <div className="release-notes-box">
          <span className="release-notes-heading">Release Notes for v{latestVersion}:</span>
          <pre className="release-notes-content">{releaseNotes}</pre>
        </div>
      )}

      {/* Progress Bar during download */}
      {isInstalling && (
        <div className="update-progress-container">
          <div
            className="update-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={downloadProgress}
            aria-label="Update download progress"
          >
            <div
              className="update-progress-fill"
              style={{ width: `${Math.max(downloadProgress, 5)}%` }}
            ></div>
          </div>
        </div>
      )}

      {/* Error notification banner */}
      {errorMessage && (
        <div className="update-error-banner">
          <AlertCircle size={14} />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
};

