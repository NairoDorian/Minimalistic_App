pub mod global_hotkeys;
pub mod hotkeys;

use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use tauri::{
    AppHandle, Emitter, Manager, State, WindowEvent,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_log::{Builder as LogBuilder, RotationStrategy, Target, TargetKind};
use tauri_specta::collect_commands;

use crate::global_hotkeys::{
    GlobalHotkeyAction, GlobalHotkeyBinding, GlobalHotkeyStatus, GlobalHotkeys,
};

/// Persistent application preferences saved as JSON in the OS app configuration directory.
#[derive(Serialize, Deserialize, Clone, Type, Debug, PartialEq, Eq)]
pub struct AppSettings {
    /// Controls whether closing the main GUI window minimizes the app to the system tray
    /// instead of terminating the application process. Default is false.
    #[serde(default)]
    pub minimize_to_tray: bool,
    /// Controls whether the application starts silently minimized to the system tray on launch.
    #[serde(default)]
    pub start_minimized: bool,
    /// Controls whether the application checks for updates on startup.
    #[serde(default = "default_true")]
    pub check_updates_on_launch: bool,
    /// Selected theme accent color ID (e.g. "cyan", "emerald", "violet", "amber", "rose").
    #[serde(default = "default_theme_accent")]
    pub theme_accent: String,
    /// Whether the main window restores its last size on startup.
    #[serde(default)]
    pub remember_window_size: bool,
    /// Whether the main window restores its last position on startup.
    #[serde(default)]
    pub remember_window_position: bool,
    /// Last persisted window width in physical pixels (0 = unset).
    #[serde(default)]
    pub saved_window_width: u32,
    /// Last persisted window height in physical pixels (0 = unset).
    #[serde(default)]
    pub saved_window_height: u32,
    /// Last persisted window X in physical pixels (`i32::MIN` = unset).
    #[serde(default = "default_unset_position")]
    pub saved_window_x: i32,
    /// Last persisted window Y in physical pixels (`i32::MIN` = unset).
    #[serde(default = "default_unset_position")]
    pub saved_window_y: i32,
    /// Whether the OS-wide global hotkey listener runs at all. Off by default:
    /// it installs a system keyboard hook, which is opt-in behaviour.
    #[serde(default)]
    pub global_hotkeys_enabled: bool,
    /// User-configured global hotkeys, one entry per bound action. Actions with
    /// no entry (or an empty spec) are unbound.
    #[serde(default)]
    pub global_hotkeys: Vec<GlobalHotkeyBinding>,
}

fn default_true() -> bool {
    true
}

fn default_theme_accent() -> String {
    "cyan".to_string()
}

/// Sentinel for "no saved position" — `i32::MIN` is never a real screen coordinate,
/// so it safely distinguishes "unset" from a legitimate (possibly negative) position.
fn default_unset_position() -> i32 {
    i32::MIN
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            minimize_to_tray: false,
            start_minimized: false,
            check_updates_on_launch: true,
            theme_accent: "cyan".to_string(),
            remember_window_size: false,
            remember_window_position: false,
            saved_window_width: 0,
            saved_window_height: 0,
            saved_window_x: i32::MIN,
            saved_window_y: i32::MIN,
            global_hotkeys_enabled: false,
            global_hotkeys: Vec::new(),
        }
    }
}

/// Runtime platform and version metadata returned to the frontend by `get_app_info`.
#[derive(Serialize, Type)]
pub struct AppInfo {
    /// Product name from `tauri.conf.json` (via `PackageInfo`), not the crate name.
    pub name: String,
    /// App version from `tauri.conf.json` (via `PackageInfo`), not the crate name.
    pub version: String,
    /// Tauri framework version this binary was compiled against.
    pub tauri_version: String,
    /// Target operating system, e.g. `windows`, `macos`, `linux`.
    pub os: String,
    /// Target CPU architecture, e.g. `x86_64`, `aarch64`.
    pub arch: String,
}

/// System and process diagnostic telemetry returned by `get_system_stats`.
#[derive(Serialize, Type)]
pub struct SystemStats {
    pub process_id: u32,
    pub os: String,
    pub arch: String,
    pub tauri_version: String,
}

/// Shared application state managed by Tauri state container.
/// Holds runtime user preferences, file paths, and application lifecycle flags.
pub struct AppState {
    /// Persistent preferences protected by a Mutex for thread-safe access.
    pub settings: Mutex<AppSettings>,
    /// Resolved filesystem path for `settings.json`.
    pub settings_path: PathBuf,
    /// Flag set to true when explicit application quit is triggered (e.g. via Tray menu).
    /// Used by `WindowEvent::CloseRequested` listener to bypass window close prevention.
    pub is_quitting: Mutex<bool>,
    /// Supervises the OS-wide global hotkey listener (see `global_hotkeys`).
    pub global_hotkeys: GlobalHotkeys,
}

/// Locks a `Mutex`, transparently recovering from poisoning.
///
/// A `PoisonError` only occurs when a thread panicked while holding the lock.
/// The protected data is still in a valid state (Tauri state and settings are
/// infallibly constructed), so continuing is safe and avoids a panic cascade.
pub(crate) fn lock_guard<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Moves an unparseable settings file aside to `settings.json.bak` before the
/// app falls back to defaults, so a corrupt (or hand-edited) file is recoverable
/// instead of being silently overwritten by the next save. Every field carries a
/// serde default, so this only triggers on genuinely malformed JSON.
fn quarantine_unreadable_settings(path: &Path) {
    let backup = path.with_extension("json.bak");
    match fs::rename(path, &backup) {
        Ok(()) => log::warn!(
            "[settings] Preserved the unreadable settings file at {}",
            backup.display()
        ),
        Err(err) => log::warn!("[settings] Could not preserve unreadable settings file: {err}"),
    }
}

/// Loads settings from disk, falling back to defaults if the file is missing
/// or cannot be parsed. Failures are logged so corrupt state is never silently
/// ignored by the UI, and an unparseable file is preserved as `.bak`.
fn load_settings_from_disk(path: &Path) -> AppSettings {
    match fs::read_to_string(path) {
        Ok(content) => match serde_json::from_str::<AppSettings>(&content) {
            Ok(settings) => settings,
            Err(err) => {
                log::error!(
                    "[settings] Failed to parse {}: {err} — using defaults",
                    path.display()
                );
                quarantine_unreadable_settings(path);
                AppSettings::default()
            }
        },
        Err(err) if err.kind() == ErrorKind::NotFound => AppSettings::default(),
        Err(err) => {
            log::error!(
                "[settings] Failed to read {}: {err} — using defaults",
                path.display()
            );
            AppSettings::default()
        }
    }
}

/// Helper function to persist settings to disk, creating parent directories as needed.
/// Uses atomic write-and-rename (writing to an adjacent temporary file first)
/// so that sudden OS power loss or process crashes can never leave a corrupt, truncated,
/// or zero-byte settings file.
/// Returns a descriptive error message so IPC callers can surface failures to the UI.
fn save_settings_to_disk(path: &Path, settings: &AppSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create settings directory: {e}"))?;
    }
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {e}"))?;

    // Atomic persistence: write to an adjacent temporary file first, then atomically rename.
    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, json.as_bytes())
        .map_err(|e| format!("Failed to write temporary settings file: {e}"))?;

    fs::rename(&tmp_path, path)
        .or_else(|_| {
            // Fallback for filesystem targets where atomic replace requires removing the target first
            let _ = fs::remove_file(path);
            fs::rename(&tmp_path, path)
        })
        .map_err(|e| format!("Failed to commit settings file: {e}"))
}

/// Tauri IPC command: Retrieves current minimize-to-tray preference.
#[tauri::command]
#[specta::specta]
fn get_minimize_to_tray(state: State<'_, AppState>) -> bool {
    lock_guard(&state.settings).minimize_to_tray
}

/// Tauri IPC command: Updates current minimize-to-tray preference and persists to disk.
///
/// The settings lock is held across the whole read-modify-write. Taking it three
/// separate times would let a concurrent writer (`update_app_settings`, or a
/// window move updating the in-memory geometry) slip in between the clone and
/// the write-back, silently discarding its change.
#[tauri::command]
#[specta::specta]
fn set_minimize_to_tray(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    let mut settings = lock_guard(&state.settings);
    if settings.minimize_to_tray == enabled {
        return Ok(());
    }
    let mut next = settings.clone();
    next.minimize_to_tray = enabled;
    // Commit to disk first: on failure the in-memory state stays untouched, so
    // memory and disk can never disagree about what was persisted.
    save_settings_to_disk(&state.settings_path, &next)?;
    *settings = next;
    Ok(())
}

/// Tauri IPC command: Retrieves the entire persisted `AppSettings` struct.
#[tauri::command]
#[specta::specta]
fn get_app_settings(state: State<'_, AppState>) -> AppSettings {
    lock_guard(&state.settings).clone()
}

/// Tauri IPC command: Atomically updates and persists the full `AppSettings` struct.
#[tauri::command]
#[specta::specta]
fn update_app_settings(settings: AppSettings, state: State<'_, AppState>) -> Result<(), String> {
    // Held across the write so concurrent savers can't interleave and leave the
    // file describing one struct while memory holds another.
    let mut current = lock_guard(&state.settings);
    save_settings_to_disk(&state.settings_path, &settings)?;
    *current = settings;
    Ok(())
}

/// Tauri IPC command: Restores `AppSettings` to factory defaults and persists to disk.
#[tauri::command]
#[specta::specta]
fn reset_app_settings(state: State<'_, AppState>) -> Result<(), String> {
    let mut current = lock_guard(&state.settings);
    let defaults = AppSettings::default();
    save_settings_to_disk(&state.settings_path, &defaults)?;
    *current = defaults;
    Ok(())
}

/// Returns application and runtime system diagnostic information.
#[tauri::command]
#[specta::specta]
fn get_app_info(app: AppHandle) -> AppInfo {
    let package_info = app.package_info();
    AppInfo {
        name: package_info.name.to_string(),
        version: package_info.version.to_string(),
        tauri_version: tauri::VERSION.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

/// Tauri IPC command: Returns system and process telemetry stats.
#[tauri::command]
#[specta::specta]
fn get_system_stats() -> SystemStats {
    SystemStats {
        process_id: std::process::id(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        tauri_version: tauri::VERSION.to_string(),
    }
}

/// Tauri IPC command: Opens the OS-specific application data directory in the native file explorer.
#[tauri::command]
#[specta::specta]
fn open_app_data_dir(state: State<'_, AppState>) -> Result<(), String> {
    let dir = state.settings_path.parent().unwrap_or(&state.settings_path);

    // The config directory is only created on the first settings write. Create it
    // up front so the file manager opens the real location instead of silently
    // falling back to Home/Documents for a non-existent path.
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create app data directory: {e}"))?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("Failed to open Windows Explorer: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {e}"))?;
    }

    Ok(())
}

/* ─────────────────────────  Global hotkey IPC surface  ───────────────────── */

/// Returns one binding per action, filling in an empty spec for anything
/// unbound, so the UI can render the complete list without duplicating the
/// action set on the frontend.
fn bindings_for_ui(settings: &AppSettings) -> Vec<GlobalHotkeyBinding> {
    GlobalHotkeyAction::ALL
        .iter()
        .map(|&action| GlobalHotkeyBinding {
            action,
            spec: settings
                .global_hotkeys
                .iter()
                .find(|binding| binding.action == action)
                .map(|binding| binding.spec.clone())
                .unwrap_or_default(),
        })
        .collect()
}

/// Tauri IPC command: Lists every global hotkey action and its current binding.
#[tauri::command]
#[specta::specta]
fn get_global_hotkeys(state: State<'_, AppState>) -> Vec<GlobalHotkeyBinding> {
    bindings_for_ui(&lock_guard(&state.settings))
}

/// Tauri IPC command: Reports whether the OS listener is running, and why not.
#[tauri::command]
#[specta::specta]
fn get_global_hotkey_status(state: State<'_, AppState>) -> GlobalHotkeyStatus {
    state.global_hotkeys.status()
}

/// Tauri IPC command: Validates and canonicalizes a hotkey spec without binding
/// it — lets the recorder UI reject an unusable chord before it is saved.
#[tauri::command]
#[specta::specta]
fn validate_hotkey_spec(spec: String) -> Result<String, String> {
    global_hotkeys::canonicalize_spec(&spec)
}

/// Tauri IPC command: Binds (or, with an empty spec, clears) one global hotkey,
/// persists it, and restarts the listener.
#[tauri::command]
#[specta::specta]
fn set_global_hotkey(
    action: GlobalHotkeyAction,
    spec: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let canonical = global_hotkeys::canonicalize_spec(&spec)?;

    // Scoped so the settings lock is released before the listener is rebuilt:
    // rebuilding joins the dispatch thread, and that thread manipulates windows.
    let (enabled, bindings) = {
        let mut settings = lock_guard(&state.settings);

        if !canonical.is_empty()
            && let Some(conflict) = settings
                .global_hotkeys
                .iter()
                .find(|binding| binding.action != action && binding.spec == canonical)
        {
            return Err(format!(
                "{canonical} is already bound to another global action ({})",
                conflict.action.as_str()
            ));
        }

        let mut next = settings.clone();
        next.global_hotkeys
            .retain(|binding| binding.action != action);
        if !canonical.is_empty() {
            next.global_hotkeys.push(GlobalHotkeyBinding {
                action,
                spec: canonical,
            });
        }

        save_settings_to_disk(&state.settings_path, &next)?;
        *settings = next.clone();
        (next.global_hotkeys_enabled, next.global_hotkeys)
    };

    state.global_hotkeys.apply(&app, enabled, &bindings);
    Ok(())
}

/// Tauri IPC command: Turns the global hotkey listener on or off and persists it.
#[tauri::command]
#[specta::specta]
fn set_global_hotkeys_enabled(
    enabled: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let bindings = {
        let mut settings = lock_guard(&state.settings);
        let mut next = settings.clone();
        next.global_hotkeys_enabled = enabled;
        save_settings_to_disk(&state.settings_path, &next)?;
        *settings = next.clone();
        next.global_hotkeys
    };

    state.global_hotkeys.apply(&app, enabled, &bindings);
    Ok(())
}

/// Tauri IPC command: Opens the macOS Accessibility settings pane so the user
/// can grant the permission global hotkeys need there. A no-op elsewhere.
#[tauri::command]
#[specta::specta]
fn open_accessibility_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        hotkeys::open_accessibility_settings().map_err(|err| err.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

/// Resolves the backend log file path using the same derivation the
/// `tauri-plugin-log` `LogDir` target uses (package name + `.log` extension),
/// so the Dev Console never hardcodes a filename that drifts from the app name
/// after a `rename-project` rebrand.
fn log_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to resolve log directory: {e}"))?;
    Ok(log_dir
        .join(app.package_info().name.clone())
        .with_extension("log"))
}

/// Returns the last `max_lines` lines of the backend log file, newest last,
/// as a single newline-joined string. Mirrors the S2B2S `get_recent_logs`
/// command so the Dev Console can reconcile its live stream with disk.
#[tauri::command]
#[specta::specta]
fn get_recent_logs(app: AppHandle, max_lines: u32) -> Result<String, String> {
    let log_file_path = log_file_path(&app)?;
    if !log_file_path.exists() {
        return Ok(String::new());
    }
    let content =
        fs::read_to_string(&log_file_path).map_err(|e| format!("Failed to read log file: {e}"))?;
    Ok(tail_lines(&content, max_lines))
}

/// Keeps only the last `max_lines` lines of log file contents.
/// Extracted as a pure helper so the truncation logic is unit-testable.
fn tail_lines(content: &str, max_lines: u32) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(max_lines as usize);
    lines[start..].join("\n")
}

/// Truncates the backend log file so the Dev Console starts clean.
#[tauri::command]
#[specta::specta]
fn clear_logs(app: AppHandle) -> Result<(), String> {
    let log_file_path = log_file_path(&app)?;
    if log_file_path.exists() {
        fs::write(&log_file_path, "").map_err(|e| format!("Failed to clear log file: {e}"))?;
    }
    Ok(())
}

/// Shows, unminimizes, and focuses the main window if it exists.
pub(crate) fn show_and_focus_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Shows and focuses the main window only when it is currently hidden or minimized.
pub(crate) fn show_window_if_hidden(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let is_visible = window.is_visible().unwrap_or(false);
        let is_minimized = window.is_minimized().unwrap_or(false);
        if !is_visible || is_minimized {
            show_and_focus_window(app);
        }
    }
}

/// Toggles main window visibility: hides if visible, shows and focuses if hidden.
pub(crate) fn toggle_window_visibility(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            show_and_focus_window(app);
        }
    }
}

/// Borrowed from the AIVORelay reference app: Windows reports a minimized window as
/// position `(-32000, -32000)` ("hottracked" out of bounds), so treat those as unusable.
fn is_windows_minimized_position(x: i32, y: i32) -> bool {
    x <= -30000 || y <= -30000
}

/// Returns true only when the saved position lands on an attached monitor, so a
/// laptop undocked from its last dock doesn't reappear on a now-missing display.
fn saved_window_position_is_usable(
    x: i32,
    y: i32,
    monitors: Result<Vec<tauri::Monitor>, tauri::Error>,
) -> bool {
    if is_windows_minimized_position(x, y) {
        return false;
    }

    let Ok(monitors) = monitors else {
        // If we can't enumerate monitors, trust the saved position.
        return true;
    };

    monitors.iter().any(|monitor| {
        let position = monitor.position();
        let size = monitor.size();
        let left = position.x;
        let top = position.y;
        let right = left + size.width as i32;
        let bottom = top + size.height as i32;

        x >= left && x < right && y >= top && y < bottom
    })
}

/// Updates the in-memory `AppSettings` window geometry (when the corresponding
/// `remember_*` flag is on). Disk is flushed once on close via
/// `flush_window_geometry` instead of on every drag/resize tick, so we never
/// rewrite settings.json dozens of times while the user is dragging the window.
fn save_window_geometry(window: &tauri::Window, save_size: bool, save_position: bool) {
    // Tauri creates configured windows before `setup()` runs, so a Moved/Resized
    // event can arrive before `AppState` is managed. `state::<T>()` panics in
    // that window; `try_state` degrades to a no-op instead.
    let Some(state) = window.try_state::<AppState>() else {
        return;
    };
    let mut settings = lock_guard(&state.settings);

    // A minimized window reports a zero-sized client area on some platforms —
    // never persist that as the restore size.
    if save_size
        && settings.remember_window_size
        && let Ok(size) = window.inner_size()
        && size.width > 0
        && size.height > 0
    {
        settings.saved_window_width = size.width;
        settings.saved_window_height = size.height;
    }

    // Only the cheap sentinel check runs here: this fires on every tick of a
    // window drag, and enumerating monitors is an OS round-trip. Whether the
    // position still lands on an attached display is re-checked at restore
    // time, which is when a monitor can actually have gone away.
    if save_position
        && settings.remember_window_position
        && let Ok(pos) = window.outer_position()
        && !is_windows_minimized_position(pos.x, pos.y)
    {
        settings.saved_window_x = pos.x;
        settings.saved_window_y = pos.y;
    }
}

/// Flushes the current in-memory window geometry to disk in a single write.
/// Called from the `CloseRequested` handler so preferences persisted by the
/// frontend (via `update_app_settings`) plus any in-memory geometry updates are
/// all on disk before the window/session tears down.
fn flush_window_geometry(window: &tauri::Window) {
    let Some(state) = window.try_state::<AppState>() else {
        return;
    };
    let settings = lock_guard(&state.settings).clone();
    if let Err(err) = save_settings_to_disk(&state.settings_path, &settings) {
        log::warn!("[settings] Failed to flush window geometry on close: {err}");
    }
}

/// Path of the generated TypeScript IPC bindings, relative to `src-tauri/`.
const BINDINGS_PATH: &str = "../src/bindings.ts";

/// Tauri Specta command registry — the single definition of the IPC surface.
///
/// Extracted from `run()` so the binding-freshness test can render exactly the
/// TypeScript a dev build exports, and fail if `src/bindings.ts` has drifted.
fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .error_handling(tauri_specta::ErrorHandlingMode::Throw)
        .commands(collect_commands![
            get_minimize_to_tray,
            set_minimize_to_tray,
            get_app_settings,
            update_app_settings,
            reset_app_settings,
            get_app_info,
            get_system_stats,
            open_app_data_dir,
            get_recent_logs,
            clear_logs,
            get_global_hotkeys,
            get_global_hotkey_status,
            validate_hotkey_spec,
            set_global_hotkey,
            set_global_hotkeys_enabled,
            open_accessibility_settings
        ])
}

/// Main entry point for Rust / Tauri backend application runtime.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();

    // Export TypeScript bindings in dev mode so the frontend can import
    // type-safe command wrappers from `../src/bindings.ts`.
    #[cfg(debug_assertions)]
    builder
        .export(specta_typescript::Typescript::default(), BINDINGS_PATH)
        .expect("Failed to export typescript bindings");

    tauri::Builder::default()
        // Single-Instance Guard: prevents duplicate tray icons
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_and_focus_window(app);
        }))
        // Autostart Plugin for OS startup management
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::AppleScript,
            Some(vec!["--autostart"]),
        ))
        // Process Plugin for app relaunch capability (used by auto-updater)
        .plugin(tauri_plugin_process::init())
        // Notification Plugin for native OS notifications (e.g. update found while window is hidden)
        .plugin(tauri_plugin_notification::init())
        // Log Plugin — streams backend diagnostics to stdout, the app log
        // directory (`<product-name>.log`, 500 KB Keep-One rotation), and the
        // webview via `log://log` events, which the Dev Console's live log viewer
        // consumes. `file_name` is left as None so the plugin derives the file
        // from `package_info().name`; `get_recent_logs`/`clear_logs` mirror that.
        .plugin(
            LogBuilder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(500_000)
                .rotation_strategy(RotationStrategy::KeepOne)
                .targets([
                    Target::new(TargetKind::Stdout),
                    // Leave `file_name` as None so the plugin derives the log file
                    // from `app.package_info().name` — a single source of truth the
                    // IPC readers (`get_recent_logs`/`clear_logs`) mirror, keeping the
                    // Dev Console valid after `rename-project` rebrands the app.
                    Target::new(TargetKind::LogDir { file_name: None }),
                    Target::new(TargetKind::Webview),
                ])
                .build(),
        )
        // Updater Plugin for GitHub Releases auto-updates
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Register type-safe IPC command handlers via Tauri Specta
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            // Mount Tauri Specta events (no-op if no events are registered)
            builder.mount_events(app);

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let config_dir = app.path().app_config_dir().unwrap_or_else(|err| {
                log::error!(
                    "[settings] Failed to resolve app config dir: {err} — falling back to current directory"
                );
                PathBuf::from(".")
            });

            let settings_path = config_dir.join("settings.json");
            let initial_settings = load_settings_from_disk(&settings_path);
            let start_minimized = initial_settings.start_minimized;

            // Manage global application state container
            app.manage(AppState {
                settings: Mutex::new(initial_settings),
                settings_path: settings_path.clone(),
                is_quitting: Mutex::new(false),
                global_hotkeys: GlobalHotkeys::new(),
            });
            log::info!(
                "[lifecycle] App state initialized — settings at {}",
                settings_path.display()
            );

            // Create native drop-down menu items for system tray icon
            let open_item = MenuItem::with_id(app, "open", "Open / Hide GUI", true, None::<&str>)?;
            let check_updates_item = MenuItem::with_id(
                app,
                "check_updates",
                "Check for Updates...",
                true,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_item, &check_updates_item, &quit_item])?;

            let icon = app
                .default_window_icon()
                .ok_or(
                    "No default window icon found — ensure icons are configured in tauri.conf.json",
                )?
                .clone();

            // Initialize System Tray Icon with event routing
            let tray = TrayIconBuilder::new()
                .icon(icon)
                .tooltip(app.package_info().name.clone())
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        log::info!("[tray] Open / Hide GUI");
                        toggle_window_visibility(app);
                    }
                    "check_updates" => {
                        log::info!("[tray] Check for Updates requested");
                        show_window_if_hidden(app);
                        let _ = app.emit("check-for-updates", ());
                    }
                    "quit" => {
                        log::info!("[tray] Quit requested — closing window");
                        let state = app.state::<AppState>();
                        *lock_guard(&state.is_quitting) = true;

                        // Detach the OS keyboard hook before teardown so no
                        // system-wide hook outlives the process.
                        app.state::<AppState>().global_hotkeys.shutdown();

                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.close();
                        } else {
                            app.exit(0);
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray_icon, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_window_visibility(tray_icon.app_handle());
                    }
                })
                .build(app)?;

            app.manage(tray);

            // The main window is declared `"visible": false` in tauri.conf.json
            // and shown here instead. That keeps geometry restoration invisible
            // (no jump from the configured default to the saved size/position)
            // and means `start_minimized` never flashes a window before hiding it.
            //
            // Restore persisted window geometry (borrowed from the AIVORelay
            // reference app) before the window is first shown, so the app
            // reopens at its last size and on the correct monitor.
            if let Some(main_window) = app.get_webview_window("main") {
                let settings = lock_guard(&app.state::<AppState>().settings).clone();
                if settings.remember_window_size
                    && settings.saved_window_width > 0
                    && settings.saved_window_height > 0
                {
                    let _ = main_window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                        width: settings.saved_window_width,
                        height: settings.saved_window_height,
                    }));
                }
                if settings.remember_window_position
                    && saved_window_position_is_usable(
                        settings.saved_window_x,
                        settings.saved_window_y,
                        main_window.available_monitors(),
                    )
                {
                    let _ = main_window.set_position(tauri::Position::Physical(
                        tauri::PhysicalPosition {
                            x: settings.saved_window_x,
                            y: settings.saved_window_y,
                        },
                    ));
                }
            }

            // Start the OS-wide global hotkey listener from the persisted
            // bindings. Failures (missing macOS Accessibility, unreadable
            // /dev/input) are recorded in the status the Preferences tab reads,
            // never fatal — the app must still run without global hotkeys.
            {
                let state = app.state::<AppState>();
                let (enabled, bindings) = {
                    let settings = lock_guard(&state.settings);
                    (settings.global_hotkeys_enabled, settings.global_hotkeys.clone())
                };
                state.global_hotkeys.apply(app.handle(), enabled, &bindings);
            }

            // If not starting minimized, focus window in foreground
            if !start_minimized {
                show_and_focus_window(app.handle());
            }

            Ok(())
        })
        // Intercept window close requested event (X button click); also persist
        // window size/position on move/resize so they restore next launch.
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                // Flush any in-memory window geometry to disk once before teardown,
                // so move/resize updates (which we now keep memory-only for perf)
                // survive close/restart without rewriting settings.json on drag.
                flush_window_geometry(window);

                let Some(state) = window.try_state::<AppState>() else {
                    return;
                };
                let is_quitting = *lock_guard(&state.is_quitting);
                let minimize = lock_guard(&state.settings).minimize_to_tray;

                if !is_quitting && minimize {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            WindowEvent::Resized(_) => save_window_geometry(window, true, false),
            WindowEvent::Moved(_) => save_window_geometry(window, false, true),
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_app_settings_default() {
        let settings = AppSettings::default();
        assert!(!settings.minimize_to_tray);
        assert!(!settings.start_minimized);
        assert!(settings.check_updates_on_launch);
        assert_eq!(settings.theme_accent, "cyan");
        // Window geometry defaults: toggles off, size unset (0), position unset (i32::MIN).
        assert!(!settings.remember_window_size);
        assert!(!settings.remember_window_position);
        assert_eq!(settings.saved_window_width, 0);
        assert_eq!(settings.saved_window_height, 0);
        assert_eq!(settings.saved_window_x, i32::MIN);
        assert_eq!(settings.saved_window_y, i32::MIN);
    }

    #[test]
    fn test_app_settings_json_roundtrip() {
        let settings = AppSettings {
            minimize_to_tray: true,
            start_minimized: true,
            theme_accent: "emerald".to_string(),
            remember_window_size: true,
            remember_window_position: true,
            saved_window_width: 1024,
            saved_window_height: 768,
            saved_window_x: 100,
            saved_window_y: 200,
            global_hotkeys_enabled: true,
            global_hotkeys: vec![GlobalHotkeyBinding {
                action: GlobalHotkeyAction::CheckUpdates,
                spec: "Ctrl+Opt+U".to_string(),
            }],
            ..Default::default()
        };

        let json = serde_json::to_string(&settings).expect("serialization failed");
        let decoded: AppSettings = serde_json::from_str(&json).expect("deserialization failed");

        assert_eq!(settings, decoded);
    }

    #[test]
    fn test_atomic_persistence_and_recovery() {
        let temp_dir = std::env::temp_dir().join(format!("tauri_test_{}", std::process::id()));
        let _ = fs::create_dir_all(&temp_dir);
        let settings_path = temp_dir.join("test_settings.json");

        let initial = AppSettings {
            minimize_to_tray: true,
            start_minimized: false,
            check_updates_on_launch: true,
            theme_accent: "violet".to_string(),
            remember_window_size: true,
            remember_window_position: true,
            saved_window_width: 1024,
            saved_window_height: 768,
            saved_window_x: 100,
            saved_window_y: 200,
            global_hotkeys_enabled: true,
            global_hotkeys: vec![GlobalHotkeyBinding {
                action: GlobalHotkeyAction::ToggleWindow,
                spec: "Ctrl+Opt+Space".to_string(),
            }],
        };

        save_settings_to_disk(&settings_path, &initial).expect("atomic save failed");
        let loaded = load_settings_from_disk(&settings_path);
        assert_eq!(initial, loaded);

        // Cleanup
        let _ = fs::remove_file(&settings_path);
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_mutex_lock_guard_recovery() {
        let mutex = Mutex::new(42);
        {
            let guard = lock_guard(&mutex);
            assert_eq!(*guard, 42);
        }
    }

    #[test]
    fn test_tail_lines_keeps_newest() {
        let content = "line1\nline2\nline3\nline4\n";
        assert_eq!(tail_lines(content, 2), "line3\nline4");
        assert_eq!(tail_lines(content, 10), "line1\nline2\nline3\nline4");
        assert_eq!(tail_lines(content, 0), "");
        assert_eq!(tail_lines("", 5), "");
    }

    #[test]
    fn test_settings_tolerate_missing_fields() {
        // Every field carries a serde default, so a settings.json written by an
        // older (or newer) build must still load instead of resetting everything.
        let partial = r#"{ "theme_accent": "violet" }"#;
        let decoded: AppSettings = serde_json::from_str(partial).expect("partial parse failed");
        assert_eq!(decoded.theme_accent, "violet");
        assert_eq!(
            decoded.minimize_to_tray,
            AppSettings::default().minimize_to_tray
        );
        assert!(decoded.check_updates_on_launch);

        // An entirely empty object must yield exactly the factory defaults.
        let empty: AppSettings = serde_json::from_str("{}").expect("empty parse failed");
        assert_eq!(empty, AppSettings::default());
    }

    #[test]
    fn test_corrupt_settings_are_quarantined_not_destroyed() {
        let temp_dir = std::env::temp_dir().join(format!("tauri_corrupt_{}", std::process::id()));
        let _ = fs::create_dir_all(&temp_dir);
        let settings_path = temp_dir.join("settings.json");
        fs::write(&settings_path, "{ this is not json").expect("write failed");

        let loaded = load_settings_from_disk(&settings_path);
        assert_eq!(loaded, AppSettings::default());

        // The unreadable file is preserved next to the original, and the original
        // is gone so the next save starts from a clean, valid file.
        let backup = settings_path.with_extension("json.bak");
        assert!(backup.exists(), "corrupt settings should be kept as .bak");
        assert!(!settings_path.exists());
        assert_eq!(
            fs::read_to_string(&backup).expect("backup unreadable"),
            "{ this is not json"
        );

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_missing_settings_file_uses_defaults_without_backup() {
        let temp_dir = std::env::temp_dir().join(format!("tauri_missing_{}", std::process::id()));
        let _ = fs::create_dir_all(&temp_dir);
        let settings_path = temp_dir.join("settings.json");

        assert_eq!(
            load_settings_from_disk(&settings_path),
            AppSettings::default()
        );
        assert!(!settings_path.with_extension("json.bak").exists());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_saved_window_position_rejects_offscreen_and_sentinel() {
        // No attached monitor contains the point -> unusable.
        assert!(!saved_window_position_is_usable(100, 100, Ok(Vec::new())));
        // The Windows minimized sentinel is rejected before monitors are consulted.
        assert!(!saved_window_position_is_usable(
            -32000,
            -32000,
            Ok(Vec::new())
        ));
    }

    #[test]
    fn test_is_windows_minimized_position() {
        // Windows "hottracks" a minimized window to (-32000, -32000).
        assert!(is_windows_minimized_position(-32000, -32000));
        assert!(is_windows_minimized_position(i32::MIN, 0));
        assert!(is_windows_minimized_position(0, i32::MIN));
        // Genuine on-screen coordinates are usable.
        assert!(!is_windows_minimized_position(0, 0));
        assert!(!is_windows_minimized_position(1920, 1080));
    }
}
