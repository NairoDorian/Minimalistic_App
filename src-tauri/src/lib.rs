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
#[derive(Serialize, Deserialize)]
pub struct AppSettings {
    /// Controls whether closing the main GUI window minimizes the app to the system tray
    /// instead of terminating the application process. Default is false.
    pub minimize_to_tray: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            minimize_to_tray: false,
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
/// Returns a descriptive error message so IPC callers can surface failures to the UI.
fn save_settings_to_disk(path: &Path, settings: &AppSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create settings directory: {e}"))?;
    }
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {e}"))?;
    fs::write(path, json).map_err(|e| format!("Failed to write settings file: {e}"))
}

/// Tauri IPC command: Retrieves current minimize-to-tray preference.
#[tauri::command]
fn get_minimize_to_tray(state: State<'_, AppState>) -> bool {
    lock_guard(&state.settings).minimize_to_tray
}

/// Tauri IPC command: Updates current minimize-to-tray preference and persists to disk.
/// Returns an error when the on-disk persistence fails so the frontend can roll back its UI.
#[tauri::command]
fn set_minimize_to_tray(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    // Persist the new value to disk first, then commit it to memory. If the disk
    // write fails, neither the in-memory state nor the UI changes, so the setting
    // can never silently drift between memory, disk, and UI (previously the memory
    // was mutated first, leaving a stale value behind on write failure).
    if lock_guard(&state.settings).minimize_to_tray == enabled {
        return Ok(());
    }
    let new_settings = AppSettings {
        minimize_to_tray: enabled,
    };
    save_settings_to_disk(&state.settings_path, &new_settings)?;
    *lock_guard(&state.settings) = new_settings;
    Ok(())
}

/// Tauri IPC command: Returns application and runtime system diagnostic information.
/// Reads name/version from `AppHandle::package_info()` (single source of truth:
/// `tauri.conf.json`), so the UI metadata can never drift from the bundle config.
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

/// Shows, unminimizes, and focuses the main window if it exists.
/// Used wherever the app needs to surface the GUI from the tray.
fn show_and_focus_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Shows and focuses the main window only when it is currently hidden.
/// Used by the "Check for Updates..." tray item so a focused window is left
/// undisturbed when triggering an update check from the tray.
fn show_window_if_hidden(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if !window.is_visible().unwrap_or(false) {
            show_and_focus_window(app);
        }
    }
}

/// Toggles main window visibility: hides if visible, shows and focuses if hidden.
/// Extracted to eliminate code duplication between tray icon click and tray menu "Open" item.
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
        // Register Tauri v2 Single-Instance Plugin: prevents duplicate tray icons
        // when the app is launched a second time. The existing instance surfaces
        // and focuses its main window instead. Must be registered before other
        // plugins so it can intercept the second launch at startup.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_and_focus_window(app);
        }))
        // Register Tauri v2 Autostart Plugin for OS startup management.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::AppleScript,
            Some(vec!["--autostart"]),
        ))
        // Register Tauri v2 Process Plugin for app relaunch capability (used by auto-updater)
        .plugin(tauri_plugin_process::init())
        // Register Tauri v2 Updater Plugin for GitHub Releases auto-updates
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // macOS: run as a menu-bar-only utility (no Dock icon). The tray icon
            // is the primary entry point; the GUI window still opens normally on
            // launch. Ignored on Windows/Linux.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Resolve the OS-specific application configuration directory, which is
            // already scoped to the app identifier (com.minimalistic.app) on every
            // platform: %APPDATA%\com.minimalistic.app (Windows),
            // ~/.config/com.minimalistic.app (Linux), ~/Library/Application Support/
            // com.minimalistic.app (macOS). No extra subfolder juggling required.
            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| PathBuf::from("."));

            let settings_path = config_dir.join("settings.json");
            let initial_settings = load_settings_from_disk(&settings_path);

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

            // Resolve app icon with a descriptive setup error instead of panicking
            // if the default icon is unconfigured (misconfiguration should fail the
            // launch gracefully, not abort the process mid-bootstrap).
            let icon = app
                .default_window_icon()
                .ok_or(
                    "No default window icon found — ensure icons are configured in tauri.conf.json",
                )?
                .clone();

            // Initialize System Tray Icon with event routing. The tooltip reads the
            // product name from package_info() so it always matches tauri.conf.json.
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
                        // Surface the window only if hidden, then notify the webview.
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

            // Store tray handle in app state to prevent garbage collection / drop
            app.manage(tray);

            Ok(())
        })
        // Register IPC command handlers callable from React frontend
        .invoke_handler(tauri::generate_handler![
            get_minimize_to_tray,
            set_minimize_to_tray,
            get_app_info
        ])
        // Intercept window close requested event (X button click)
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let is_quitting = *lock_guard(&state.is_quitting);
                let minimize = lock_guard(&state.settings).minimize_to_tray;

                // If minimize-to-tray is enabled and user didn't click Quit, hide window instead of closing
                if !is_quitting && minimize {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
