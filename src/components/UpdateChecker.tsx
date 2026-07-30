import React, { useState, useEffect, useRef } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { listen } from "@tauri-apps/api/event";
import { RefreshCw, Download, CheckCircle2, AlertCircle, ExternalLink, X } from "lucide-react";

interface UpdateCheckerProps {
  autoCheckOnMount?: boolean;
  onStatusChange?: (status: string) => void;
  variant?: "card" | "footer";
}

export const UpdateChecker: React.FC<UpdateCheckerProps> = ({
  autoCheckOnMount = true,
  onStatusChange,
  variant = "card",
}) => {
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);
  const [isInstalling, setIsInstalling] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [showUpToDate, setShowUpToDate] = useState<boolean>(false);
  const [showPortableDialog, setShowPortableDialog] = useState<boolean>(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pendingUpdateRef = useRef<Update | null>(null);
  const upToDateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isManualCheckRef = useRef<boolean>(false);
  const downloadedBytesRef = useRef<number>(0);
  const contentLengthRef = useRef<number>(0);

  // Check if running in Tauri runtime environment
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  useEffect(() => {
    if (!isTauri) return;

    if (autoCheckOnMount) {
      checkForUpdates(false);
    }

    // Listen for manual update trigger from System Tray context menu
    const unlistenPromise = listen("check-for-updates", () => {
      handleManualCheck();
    });

    return () => {
      if (upToDateTimeoutRef.current) {
        clearTimeout(upToDateTimeoutRef.current);
      }
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [isTauri]);

  const updateStatus = (msg: string) => {
    if (onStatusChange) onStatusChange(msg);
  };

  const checkForUpdates = async (isManual = false) => {
    if (!isTauri || isChecking || isInstalling) return;

    isManualCheckRef.current = isManual;
    setErrorMessage(null);
    setIsChecking(true);
    updateStatus("Checking for updates...");

    try {
      const update = await check();

      if (update && update.available) {
        pendingUpdateRef.current = update;
        setLatestVersion(update.version);
        setUpdateAvailable(true);
        setShowUpToDate(false);
        updateStatus(`New version v${update.version} available!`);
      } else {
        pendingUpdateRef.current = null;
        setUpdateAvailable(false);

        if (isManualCheckRef.current) {
          setShowUpToDate(true);
          updateStatus("Application is up to date");
          if (upToDateTimeoutRef.current) clearTimeout(upToDateTimeoutRef.current);
          upToDateTimeoutRef.current = setTimeout(() => {
            setShowUpToDate(false);
          }, 4000);
        } else {
          updateStatus("Up to date");
        }
      }
    } catch (error: any) {
      console.error("Failed to check for updates:", error);
      const errStr = error?.message || String(error);
      if (errStr.includes("404") || errStr.includes("Could not fetch")) {
        setErrorMessage("Update server endpoint not reached (Release binary pending)");
      } else {
        setErrorMessage("Unable to check for updates");
      }
      updateStatus("Update check failed");
    } finally {
      setIsChecking(false);
      isManualCheckRef.current = false;
    }
  };

  const handleManualCheck = () => {
    checkForUpdates(true);
  };

  const installUpdate = async () => {
    if (!isTauri) return;

    try {
      setIsInstalling(true);
      setDownloadProgress(0);
      downloadedBytesRef.current = 0;
      contentLengthRef.current = 0;
      updateStatus("Starting update download...");

      let update = pendingUpdateRef.current;
      if (!update) {
        update = await check();
      }

      if (!update || !update.available) {
        updateStatus("No update found to install");
        setIsInstalling(false);
        return;
      }

      // Download and install release binary with progress updates (Handy workflow)
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            downloadedBytesRef.current = 0;
            contentLengthRef.current = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloadedBytesRef.current += event.data.chunkLength;
            if (contentLengthRef.current > 0) {
              const pct = Math.round((downloadedBytesRef.current / contentLengthRef.current) * 100);
              setDownloadProgress(Math.min(pct, 100));
              updateStatus(`Downloading update... ${pct}%`);
            } else {
              updateStatus("Downloading update binary...");
            }
            break;
          case "Finished":
            updateStatus("Download complete. Applying update...");
            break;
        }
      });

      updateStatus("Relaunching application...");
      await relaunch();
    } catch (error: any) {
      console.error("Failed to install update:", error);
      setErrorMessage("Installation failed: " + (error?.message || String(error)));
      updateStatus("Update installation failed");
    } finally {
      setIsInstalling(false);
      setDownloadProgress(0);
    }
  };

  if (variant === "footer") {
    return (
      <div className="update-checker-footer">
        {isChecking && (
          <span className="update-status-label animate-pulse">
            <RefreshCw size={12} className="spin-icon" /> Checking updates...
          </span>
        )}
        {showUpToDate && (
          <span className="update-status-label text-success">
            <CheckCircle2 size={12} /> App is up to date
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
          <button onClick={handleManualCheck} className="btn-footer-check">
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
            <button onClick={installUpdate} className="btn-update-primary">
              <Download size={14} /> Install v{latestVersion}
            </button>
          )}

          {!updateAvailable && !isInstalling && (
            <button
              onClick={handleManualCheck}
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

      {/* Progress Bar during download */}
      {isInstalling && (
        <div className="update-progress-container">
          <div className="update-progress-track">
            <div
              className="update-progress-fill"
              style={{ width: `${Math.max(downloadProgress, 5)}%` }}
            ></div>
          </div>
        </div>
      )}

      {/* Error notification if update check fails */}
      {errorMessage && (
        <div className="update-error-banner">
          <AlertCircle size={14} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Portable Binary Fallback Dialog */}
      {showPortableDialog && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Portable App Update Notice</h3>
              <button onClick={() => setShowPortableDialog(false)} className="btn-close-modal">
                <X size={16} />
              </button>
            </div>
            <p>
              Portable installations require downloading the binary manually from GitHub Releases.
            </p>
            <div className="modal-actions">
              <button onClick={() => setShowPortableDialog(false)} className="btn-secondary">
                Cancel
              </button>
              <a
                href="https://github.com/your-username/minimalistic-app/releases/latest"
                target="_blank"
                rel="noreferrer"
                className="btn-primary"
              >
                <ExternalLink size={14} /> Go to Releases
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
