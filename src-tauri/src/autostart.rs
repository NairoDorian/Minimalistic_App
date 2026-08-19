//! "Start at OS launch", owned by the backend.
//!
//! # Why this is not driven from the webview
//!
//! `@tauri-apps/plugin-autostart` exposes `enable()` / `disable()` straight to
//! the frontend, and calling them registers **the path of the currently running
//! executable** with the OS. During `bun run tauri dev` that executable lives in
//! `src-tauri/target/debug/`, so a single click of the preference toggle in a
//! dev session silently replaces the *installed* application's launch entry with
//! a path into a build directory. The user finds out at the next reboot, when
//! either nothing starts (the target directory was cleaned) or a stale debug
//! build starts instead of the app they installed.
//!
//! Nothing about that failure is visible while it happens, and it is easy to hit
//! — developing a desktop app means toggling its preferences.
//!
//! So the OS registration lives here, behind two rules:
//!
//! 1. **The user's intent is stored in `AppSettings`, not in the OS.** The
//!    registry entry / launch agent is a *derived* effect of
//!    `autostart_enabled`, reconciled at startup. If something external removes
//!    the entry — a reinstall, a cleanup tool, another profile — the next launch
//!    puts it back, instead of the preference silently becoming a lie.
//! 2. **A development build never writes it.** [`is_dev_build`] gates every
//!    write. The preference still records what the user asked for, so the
//!    setting survives into the release build; only the OS-visible side effect
//!    is suppressed, and the UI is told so it can say why.
//!
//! Adapted from the `#[cfg(not(debug_assertions))]` guard around autostart
//! reconciliation in [AIVORelay](https://github.com/MaxITService/AIVORelay).

use serde::Serialize;
use specta::Type;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

/// True when this binary was compiled without optimizations — `cargo run`,
/// `tauri dev`, or `tauri build --debug`.
///
/// `debug_assertions` is the right signal rather than an environment variable:
/// it is baked in at compile time, so it cannot be spoofed by a launcher and it
/// correctly classifies a debug bundle that was installed like a release one.
pub const fn is_dev_build() -> bool {
    cfg!(debug_assertions)
}

/// What the frontend needs to render the autostart toggle honestly.
#[derive(Serialize, Type, Debug, Clone, PartialEq, Eq)]
pub struct AutostartStatus {
    /// The user's stored preference — the source of truth for the toggle.
    pub enabled: bool,
    /// Whether the OS launch entry is actually registered right now.
    ///
    /// In a release build this tracks `enabled`. In a dev build it reports the
    /// *installed* application's state, which is deliberately left alone, so the
    /// two can legitimately disagree.
    pub os_registered: bool,
    /// True when this build refuses to write the OS entry, so the UI can explain
    /// why flipping the switch had no effect outside the app.
    pub dev_build: bool,
}

/// Reads whether the OS launch entry is registered.
///
/// Reading is always safe — it inspects, it does not write — so this is not
/// gated on the build kind. A failure is reported as "not registered" rather
/// than as an error: on a platform or in a sandbox where the query is
/// unavailable, an unchecked toggle is the truthful, least-surprising answer.
fn os_registered(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or_else(|err| {
        log::warn!("[autostart] Could not query the OS launch entry: {err}");
        false
    })
}

/// Reports the stored preference alongside the real OS state.
pub fn status(app: &AppHandle, enabled: bool) -> AutostartStatus {
    AutostartStatus {
        enabled,
        os_registered: os_registered(app),
        dev_build: is_dev_build(),
    }
}

/// Brings the OS launch entry in line with the stored preference.
///
/// Returns `Ok(false)` when the write was deliberately skipped because this is a
/// development build, and `Ok(true)` when the OS was actually asked to change.
/// An error means the OS rejected the change and the caller should surface it —
/// the preference is still recorded, so the next release build will retry.
pub fn reconcile(app: &AppHandle, enabled: bool) -> Result<bool, String> {
    if is_dev_build() {
        log::warn!(
            "[autostart] Development build: leaving the OS launch entry untouched \
             (preference recorded as {enabled}). Registering it here would point the \
             OS at target/debug and clobber the installed app's entry."
        );
        return Ok(false);
    }

    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };

    result.map_err(|err| format!("Failed to update the OS launch entry: {err}"))?;
    log::info!(
        "[autostart] OS launch entry {}",
        if enabled { "registered" } else { "removed" }
    );
    Ok(true)
}

/// Reconciles the OS entry with the stored preference at startup.
///
/// Called once from `setup()`. Failures are logged and swallowed: autostart is a
/// convenience, and an app that refuses to start because it could not write a
/// registry key would be trading a small problem for a total one.
pub fn reconcile_on_startup(app: &AppHandle, enabled: bool) {
    // Skip the no-op case so a normal launch does not touch the registry at all.
    if !is_dev_build() && enabled == os_registered(app) {
        return;
    }

    if let Err(err) = reconcile(app, enabled) {
        log::warn!("[autostart] Startup reconciliation failed: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_build_detection_matches_the_compilation_profile() {
        // Tests are compiled with debug assertions on, so this must agree.
        // The point is to pin the meaning of the constant: if someone changes it
        // to read an environment variable, this fails.
        assert_eq!(is_dev_build(), cfg!(debug_assertions));
        assert!(
            is_dev_build(),
            "the test harness is a debug build by definition"
        );
    }

    #[test]
    fn status_is_serializable_for_the_ipc_boundary() {
        let status = AutostartStatus {
            enabled: true,
            os_registered: false,
            dev_build: true,
        };
        let json = serde_json::to_string(&status).expect("status must serialize");
        assert!(json.contains("\"enabled\":true"));
        assert!(json.contains("\"os_registered\":false"));
        assert!(json.contains("\"dev_build\":true"));
    }
}
