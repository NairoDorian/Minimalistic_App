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

/// Persistent application preferences saved as JSON in the OS app configuration directory.
#[derive(Serialize, Deserialize, Clone, Type, Debug, PartialEq, Eq)]
pub struct AppSettings {
    /// Controls whether closing the main GUI window minimizes the app to the system tray
    /// instead of terminating the application process. Default is false.
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
}

/// Locks a `Mutex`, transparently recovering from poisoning.
///
/// A `PoisonError` only occurs when a thread panicked while holding the lock.
/// The protected data is still in a valid state (Tauri state and settings are
/// infallibly constructed), so continuing is safe and avoids a panic cascade.
fn lock_guard<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Loads settings from disk, falling back to defaults if the file is missing
/// or cannot be parsed. Failures are logged to stderr so corrupt state is
/// never silently ignored by the UI.
fn load_settings_from_disk(path: &Path) -> AppSettings {
    match fs::read_to_string(path) {
        Ok(content) => match serde_json::from_str::<AppSettings>(&content) {
            Ok(settings) => settings,
            Err(err) => {
                log::error!(
                    "[settings] Failed to parse {}: {err} — using defaults",
                    path.display()
                );
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
#[tauri::command]
#[specta::specta]
fn set_minimize_to_tray(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    if lock_guard(&state.settings).minimize_to_tray == enabled {
        return Ok(());
    }
    let mut new_settings = lock_guard(&state.settings).clone();
    new_settings.minimize_to_tray = enabled;
    save_settings_to_disk(&state.settings_path, &new_settings)?;
    *lock_guard(&state.settings) = new_settings;
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
    save_settings_to_disk(&state.settings_path, &settings)?;
    *lock_guard(&state.settings) = settings;
    Ok(())
}

/// Tauri IPC command: Restores `AppSettings` to factory defaults and persists to disk.
#[tauri::command]
#[specta::specta]
fn reset_app_settings(state: State<'_, AppState>) -> Result<(), String> {
    let defaults = AppSettings::default();
    save_settings_to_disk(&state.settings_path, &defaults)?;
    *lock_guard(&state.settings) = defaults;
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
fn show_and_focus_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Shows and focuses the main window only when it is currently hidden or minimized.
fn show_window_if_hidden(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let is_visible = window.is_visible().unwrap_or(false);
        let is_minimized = window.is_minimized().unwrap_or(false);
        if !is_visible || is_minimized {
            show_and_focus_window(app);
        }
    }
}

/// Toggles main window visibility: hides if visible, shows and focuses if hidden.
fn toggle_window_visibility(app: &AppHandle) {
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

/// Persists the window's current size and/or position to `AppSettings` (when the
/// corresponding `remember_*` flag is on), using dirty-checks so idle resize/move
/// events never needlessly rewrite settings.json.
fn save_window_geometry(window: &tauri::Window, save_size: bool, save_position: bool) {
    let state = window.state::<AppState>();
    let mut new_settings = lock_guard(&state.settings).clone();
    let mut changed = false;

    if save_size && new_settings.remember_window_size {
        if let Ok(size) = window.inner_size() {
            if size.width > 0
                && size.height > 0
                && (new_settings.saved_window_width != size.width
                    || new_settings.saved_window_height != size.height)
            {
                new_settings.saved_window_width = size.width;
                new_settings.saved_window_height = size.height;
                changed = true;
            }
        }
    }

    if save_position && new_settings.remember_window_position {
        if let Ok(pos) = window.outer_position() {
            if saved_window_position_is_usable(pos.x, pos.y, window.available_monitors())
                && (new_settings.saved_window_x != pos.x || new_settings.saved_window_y != pos.y)
            {
                new_settings.saved_window_x = pos.x;
                new_settings.saved_window_y = pos.y;
                changed = true;
            }
        }
    }

    if changed {
        if let Err(err) = save_settings_to_disk(&state.settings_path, &new_settings) {
            log::warn!("[settings] Failed to persist window geometry: {err}");
        } else {
            *lock_guard(&state.settings) = new_settings;
        }
    }
}

/// Main entry point for Rust / Tauri backend application runtime.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Tauri Specta builder: registers type-safe IPC command handlers and
    // auto-generates TypeScript bindings (src/bindings.ts) during dev builds.
    let builder = tauri_specta::Builder::<tauri::Wry>::new()
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
            clear_logs
        ]);

    // Export TypeScript bindings in dev mode so the frontend can import
    // type-safe command wrappers from `../src/bindings.ts`.
    #[cfg(debug_assertions)]
    builder
        .export(
            specta_typescript::Typescript::default(),
            "../src/bindings.ts",
        )
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
                let state = window.state::<AppState>();
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
        let mut settings = AppSettings::default();
        settings.minimize_to_tray = true;
        settings.start_minimized = true;
        settings.theme_accent = "emerald".to_string();
        settings.remember_window_size = true;
        settings.remember_window_position = true;
        settings.saved_window_width = 1024;
        settings.saved_window_height = 768;
        settings.saved_window_x = 100;
        settings.saved_window_y = 200;

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
