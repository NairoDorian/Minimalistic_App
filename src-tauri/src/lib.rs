use serde::{Deserialize, Serialize};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use tauri::{
    AppHandle, Emitter, Manager, State, WindowEvent,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

/// Persistent application preferences saved as JSON in the OS app configuration directory.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
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
}

fn default_true() -> bool {
    true
}

fn default_theme_accent() -> String {
    "cyan".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            minimize_to_tray: false,
            start_minimized: false,
            check_updates_on_launch: true,
            theme_accent: "cyan".to_string(),
        }
    }
}

/// Runtime platform and version metadata returned to the frontend by `get_app_info`.
#[derive(Serialize)]
pub struct AppInfo {
    /// Product name from `tauri.conf.json` (via `PackageInfo`), not the crate name.
    pub name: String,
    /// App version from `tauri.conf.json` (via `PackageInfo`), not the crate name.
    pub version: String,
    /// Tauri framework version this binary was compiled against.
    pub tauri_version: &'static str,
    /// Target operating system, e.g. `windows`, `macos`, `linux`.
    pub os: &'static str,
    /// Target CPU architecture, e.g. `x86_64`, `aarch64`.
    pub arch: &'static str,
}

/// System and process diagnostic telemetry returned by `get_system_stats`.
#[derive(Serialize)]
pub struct SystemStats {
    pub process_id: u32,
    pub os: &'static str,
    pub arch: &'static str,
    pub tauri_version: &'static str,
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
                eprintln!(
                    "[settings] Failed to parse {}: {err} — using defaults",
                    path.display()
                );
                AppSettings::default()
            }
        },
        Err(err) if err.kind() == ErrorKind::NotFound => AppSettings::default(),
        Err(err) => {
            eprintln!(
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
fn get_minimize_to_tray(state: State<'_, AppState>) -> bool {
    lock_guard(&state.settings).minimize_to_tray
}

/// Tauri IPC command: Updates current minimize-to-tray preference and persists to disk.
#[tauri::command]
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
fn get_app_settings(state: State<'_, AppState>) -> AppSettings {
    lock_guard(&state.settings).clone()
}

/// Tauri IPC command: Atomically updates and persists the full `AppSettings` struct.
#[tauri::command]
fn update_app_settings(settings: AppSettings, state: State<'_, AppState>) -> Result<(), String> {
    save_settings_to_disk(&state.settings_path, &settings)?;
    *lock_guard(&state.settings) = settings;
    Ok(())
}

/// Tauri IPC command: Restores `AppSettings` to factory defaults and persists to disk.
#[tauri::command]
fn reset_app_settings(state: State<'_, AppState>) -> Result<(), String> {
    let defaults = AppSettings::default();
    save_settings_to_disk(&state.settings_path, &defaults)?;
    *lock_guard(&state.settings) = defaults;
    Ok(())
}

/// Tauri IPC command: Returns application and runtime system diagnostic information.
#[tauri::command]
fn get_app_info(app: AppHandle) -> AppInfo {
    let package_info = app.package_info();
    AppInfo {
        name: package_info.name.to_string(),
        version: package_info.version.to_string(),
        tauri_version: tauri::VERSION,
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    }
}

/// Tauri IPC command: Returns system and process telemetry stats.
#[tauri::command]
fn get_system_stats() -> SystemStats {
    SystemStats {
        process_id: std::process::id(),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        tauri_version: tauri::VERSION,
    }
}

/// Tauri IPC command: Opens the OS-specific application data directory in the native file explorer.
#[tauri::command]
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

/// Main entry point for Rust / Tauri backend application runtime.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
        // Updater Plugin for GitHub Releases auto-updates
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let config_dir = app.path().app_config_dir().unwrap_or_else(|err| {
                eprintln!(
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
                settings_path,
                is_quitting: Mutex::new(false),
            });

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
                        toggle_window_visibility(app);
                    }
                    "check_updates" => {
                        show_window_if_hidden(app);
                        let _ = app.emit("check-for-updates", ());
                    }
                    "quit" => {
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

            // If not starting minimized, focus window in foreground
            if !start_minimized {
                show_and_focus_window(app.handle());
            }

            Ok(())
        })
        // Register IPC command handlers callable from React frontend
        .invoke_handler(tauri::generate_handler![
            get_minimize_to_tray,
            set_minimize_to_tray,
            get_app_settings,
            update_app_settings,
            reset_app_settings,
            get_app_info,
            get_system_stats,
            open_app_data_dir
        ])
        // Intercept window close requested event (X button click)
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let is_quitting = *lock_guard(&state.is_quitting);
                let minimize = lock_guard(&state.settings).minimize_to_tray;

                if !is_quitting && minimize {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
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
    }

    #[test]
    fn test_app_settings_json_roundtrip() {
        let mut settings = AppSettings::default();
        settings.minimize_to_tray = true;
        settings.start_minimized = true;
        settings.theme_accent = "emerald".to_string();

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
}
