//! App-level glue for OS-wide global hotkeys.
//!
//! [`crate::hotkeys`] provides the platform keyboard hooks; this module decides
//! what the app does with them. It owns:
//!
//! - the set of actions a global hotkey may trigger ([`GlobalHotkeyAction`]),
//! - the persisted user bindings ([`GlobalHotkeyBinding`], stored in
//!   `AppSettings`),
//! - a supervisor ([`GlobalHotkeys`]) that (re)builds the OS listener whenever
//!   those bindings change, and
//! - the status the UI shows, including the actionable permission errors that
//!   macOS and Linux can raise.
//!
//! Design note: rebinding tears the listener down and rebuilds it rather than
//! mutating a live registration. Registration is cheap, it happens only on an
//! explicit user action, and a full rebuild removes every partial-update state
//! the alternative would have to handle.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Emitter};

use crate::hotkeys::{Error as HotkeyError, Hotkey, HotkeyManager, HotkeyState};

/// How often the dispatch thread drains the hotkey channel.
///
/// The channel is lock-free and almost always empty, so this is a cheap poll.
/// Polling rather than blocking on `recv()` lets the thread observe the stop
/// flag promptly, which is what makes rebinding feel instant.
const POLL_INTERVAL: Duration = Duration::from_millis(25);

/// What triggering a global hotkey does.
///
/// Deliberately a small, safe set: a global hotkey fires from anywhere in the
/// OS, so destructive actions (quit, reset) are not offered.
#[derive(Serialize, Deserialize, Type, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum GlobalHotkeyAction {
    /// Show the window if hidden, hide it if visible.
    ToggleWindow,
    /// Always bring the window to the foreground.
    ShowWindow,
    /// Surface the window and run an update check.
    CheckUpdates,
}

impl GlobalHotkeyAction {
    /// Every action, in the order the Preferences UI lists them.
    pub const ALL: [GlobalHotkeyAction; 3] = [
        GlobalHotkeyAction::ToggleWindow,
        GlobalHotkeyAction::ShowWindow,
        GlobalHotkeyAction::CheckUpdates,
    ];

    /// Stable identifier used in the emitted event payload and in logs.
    pub fn as_str(self) -> &'static str {
        match self {
            GlobalHotkeyAction::ToggleWindow => "toggle_window",
            GlobalHotkeyAction::ShowWindow => "show_window",
            GlobalHotkeyAction::CheckUpdates => "check_updates",
        }
    }
}

/// One persisted global hotkey binding.
#[derive(Serialize, Deserialize, Type, Debug, Clone, PartialEq, Eq)]
pub struct GlobalHotkeyBinding {
    pub action: GlobalHotkeyAction,
    /// Hotkey spec string, e.g. `"Mod+Alt+Space"`. Empty means unbound.
    pub spec: String,
}

/// Runtime state of the global hotkey listener, surfaced to the UI.
#[derive(Serialize, Type, Debug, Clone, Default)]
pub struct GlobalHotkeyStatus {
    /// True when the OS listener is running.
    pub active: bool,
    /// Number of hotkeys currently registered with the OS.
    pub registered: u32,
    /// True when matched hotkeys are also withheld from other applications.
    /// False means they are detected but still reach the focused app.
    pub blocking: bool,
    /// Why the listener could not start, shown verbatim in the UI.
    pub error: Option<String>,
    /// macOS: the Accessibility permission is missing and must be granted.
    pub needs_accessibility: bool,
}

/// Supervises the OS listener thread and keeps [`GlobalHotkeyStatus`] current.
#[derive(Default)]
pub struct GlobalHotkeys {
    inner: Mutex<Supervisor>,
}

#[derive(Default)]
struct Supervisor {
    stop: Option<Arc<AtomicBool>>,
    thread: Option<JoinHandle<()>>,
    status: GlobalHotkeyStatus,
}

impl Supervisor {
    /// Signals the dispatch thread to exit and waits for it.
    ///
    /// Joining matters: the thread owns the `HotkeyManager`, whose `Drop`
    /// releases the OS hook. Returning before that completes would let a new
    /// listener install while the old one is still attached.
    fn stop(&mut self) {
        if let Some(stop) = self.stop.take() {
            stop.store(true, Ordering::SeqCst);
        }
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
        self.status = GlobalHotkeyStatus::default();
    }
}

impl GlobalHotkeys {
    pub fn new() -> Self {
        Self::default()
    }

    /// Current status, for the `get_global_hotkey_status` IPC command.
    pub fn status(&self) -> GlobalHotkeyStatus {
        crate::lock_guard(&self.inner).status.clone()
    }

    /// Tears down the running listener, if any. Called on app shutdown.
    pub fn shutdown(&self) {
        crate::lock_guard(&self.inner).stop();
    }

    /// Rebuilds the listener from the given bindings.
    ///
    /// Always succeeds from the caller's perspective — a failure to install the
    /// OS hook (missing macOS Accessibility, unreadable `/dev/input`) is
    /// recorded in [`GlobalHotkeyStatus::error`] rather than propagated, because
    /// it is a state the UI must display, not an operation the user can retry
    /// differently.
    pub fn apply(&self, app: &AppHandle, enabled: bool, bindings: &[GlobalHotkeyBinding]) {
        let mut supervisor = crate::lock_guard(&self.inner);
        supervisor.stop();

        if !enabled {
            log::debug!("[hotkeys] Global hotkeys disabled — listener not started");
            return;
        }

        let parsed = parse_bindings(bindings);
        if parsed.is_empty() {
            log::debug!("[hotkeys] No global hotkeys bound — listener not started");
            return;
        }

        // Prefer a blocking listener so a matched chord doesn't also reach the
        // focused application. Linux needs /dev/uinput for that; fall back to
        // detect-only rather than losing the feature entirely.
        let (manager, blocking) = match HotkeyManager::new_with_blocking() {
            Ok(manager) => (manager, true),
            Err(blocking_err) => match HotkeyManager::new() {
                Ok(manager) => {
                    log::warn!(
                        "[hotkeys] Falling back to detect-only global hotkeys: {blocking_err}"
                    );
                    (manager, false)
                }
                Err(err) => {
                    log::warn!("[hotkeys] Could not start the global hotkey listener: {err}");
                    supervisor.status = GlobalHotkeyStatus {
                        needs_accessibility: matches!(err, HotkeyError::AccessibilityNotGranted),
                        error: Some(err.to_string()),
                        ..GlobalHotkeyStatus::default()
                    };
                    return;
                }
            },
        };

        let mut routes: HashMap<_, GlobalHotkeyAction> = HashMap::new();
        let mut failures: Vec<String> = Vec::new();
        for (action, hotkey, spec) in parsed {
            match manager.register(hotkey) {
                Ok(id) => {
                    routes.insert(id, action);
                }
                Err(err) => {
                    log::warn!("[hotkeys] Could not register \"{spec}\": {err}");
                    failures.push(format!("{spec}: {err}"));
                }
            }
        }

        if routes.is_empty() {
            supervisor.status = GlobalHotkeyStatus {
                error: Some(if failures.is_empty() {
                    "No global hotkeys could be registered".to_string()
                } else {
                    failures.join("; ")
                }),
                ..GlobalHotkeyStatus::default()
            };
            return;
        }

        let registered = routes.len() as u32;
        let stop = Arc::new(AtomicBool::new(false));
        let thread = spawn_dispatch(app.clone(), manager, routes, Arc::clone(&stop));

        log::info!(
            "[hotkeys] Global hotkey listener started ({registered} bound, blocking={blocking})"
        );
        supervisor.stop = Some(stop);
        supervisor.thread = Some(thread);
        supervisor.status = GlobalHotkeyStatus {
            active: true,
            registered,
            blocking,
            error: (!failures.is_empty()).then(|| failures.join("; ")),
            needs_accessibility: false,
        };
    }
}

/// Parses the bound specs, skipping empty ones and logging invalid ones.
///
/// An unparseable spec is dropped rather than aborting the whole rebuild: one
/// bad entry (a hand-edited settings file, or a binding written by a newer
/// build) must never disable every other hotkey.
fn parse_bindings(bindings: &[GlobalHotkeyBinding]) -> Vec<(GlobalHotkeyAction, Hotkey, String)> {
    let mut parsed = Vec::new();
    for binding in bindings {
        let spec = binding.spec.trim();
        if spec.is_empty() {
            continue;
        }
        match spec.parse::<Hotkey>() {
            Ok(hotkey) => parsed.push((binding.action, hotkey, spec.to_string())),
            Err(err) => log::warn!("[hotkeys] Ignoring invalid global hotkey \"{spec}\": {err}"),
        }
    }
    parsed
}

/// Spawns the thread that owns the manager and routes presses to actions.
fn spawn_dispatch(
    app: AppHandle,
    manager: HotkeyManager,
    routes: HashMap<crate::hotkeys::HotkeyId, GlobalHotkeyAction>,
    stop: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        while !stop.load(Ordering::SeqCst) {
            // Drain everything queued before sleeping, so a burst of events is
            // handled in one pass instead of one per poll interval.
            while let Some(event) = manager.try_recv() {
                if event.state != HotkeyState::Pressed {
                    continue;
                }
                if let Some(&action) = routes.get(&event.id) {
                    dispatch(&app, action);
                }
            }
            thread::sleep(POLL_INTERVAL);
        }
        // `manager` drops here, releasing the OS hook.
    })
}

/// Performs a hotkey's action and notifies the frontend.
fn dispatch(app: &AppHandle, action: GlobalHotkeyAction) {
    log::info!("[hotkeys] Global hotkey fired: {}", action.as_str());

    match action {
        GlobalHotkeyAction::ToggleWindow => crate::toggle_window_visibility(app),
        GlobalHotkeyAction::ShowWindow => crate::show_and_focus_window(app),
        GlobalHotkeyAction::CheckUpdates => {
            crate::show_window_if_hidden(app);
            let _ = app.emit("check-for-updates", ());
        }
    }

    // Let the UI acknowledge the hotkey (toast, status line) without having to
    // infer it from the window state change.
    let _ = app.emit("global-hotkey", action.as_str());
}

/// Validates and canonicalizes a spec string, e.g. `"cmdorctrl+alt+space"` →
/// `"Opt+Ctrl+Space"` on Windows. Returns a user-facing message on failure.
pub fn canonicalize_spec(spec: &str) -> Result<String, String> {
    let trimmed = spec.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    trimmed
        .parse::<Hotkey>()
        .map(|hotkey| hotkey.to_string())
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding(action: GlobalHotkeyAction, spec: &str) -> GlobalHotkeyBinding {
        GlobalHotkeyBinding {
            action,
            spec: spec.to_string(),
        }
    }

    #[test]
    fn every_action_has_a_stable_identifier() {
        let ids: Vec<&str> = GlobalHotkeyAction::ALL.iter().map(|a| a.as_str()).collect();
        assert_eq!(ids, ["toggle_window", "show_window", "check_updates"]);
        // The serde representation must match the event payload identifier, so
        // the frontend can switch on one value.
        for action in GlobalHotkeyAction::ALL {
            let json = serde_json::to_string(&action).unwrap();
            assert_eq!(json, format!("\"{}\"", action.as_str()));
        }
    }

    #[test]
    fn parse_bindings_keeps_valid_and_drops_the_rest() {
        let parsed = parse_bindings(&[
            binding(GlobalHotkeyAction::ToggleWindow, "Ctrl+Alt+Space"),
            binding(GlobalHotkeyAction::ShowWindow, ""),
            binding(GlobalHotkeyAction::CheckUpdates, "   "),
        ]);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].0, GlobalHotkeyAction::ToggleWindow);
        assert_eq!(parsed[0].2, "Ctrl+Alt+Space");
    }

    #[test]
    fn one_invalid_binding_never_disables_the_others() {
        let parsed = parse_bindings(&[
            binding(GlobalHotkeyAction::ToggleWindow, "!!!not a hotkey!!!"),
            binding(GlobalHotkeyAction::ShowWindow, "Ctrl+Alt+S"),
        ]);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].0, GlobalHotkeyAction::ShowWindow);
    }

    #[test]
    fn canonicalize_normalizes_aliases_and_reports_errors() {
        // Aliases collapse to the canonical spelling and Display order.
        assert_eq!(
            canonicalize_spec("ctrl+alt+space").unwrap(),
            "Ctrl+Opt+Space"
        );
        assert_eq!(canonicalize_spec("  f5  ").unwrap(), "F5");
        // The platform-resolving alias is accepted and resolved.
        assert!(canonicalize_spec("Mod+Alt+K").is_ok());
        // Empty means "unbound", not an error.
        assert_eq!(canonicalize_spec("   ").unwrap(), "");
        // Failures carry a message the UI can show as-is.
        let err = canonicalize_spec("Ctrl+Nonsense").unwrap_err();
        assert!(err.contains("Nonsense"), "{err}");
    }

    #[test]
    fn canonical_specs_round_trip() {
        for spec in ["Ctrl+Alt+Space", "Cmd+Shift+K", "F5", "CtrlRight+Space"] {
            let canonical = canonicalize_spec(spec).unwrap();
            assert_eq!(canonicalize_spec(&canonical).unwrap(), canonical);
        }
    }

    #[test]
    fn status_defaults_to_inactive() {
        let status = GlobalHotkeyStatus::default();
        assert!(!status.active);
        assert!(!status.needs_accessibility);
        assert_eq!(status.registered, 0);
        assert!(status.error.is_none());
    }
}
