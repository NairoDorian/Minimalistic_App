use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};

/// Persistent application preferences saved as JSON in the OS app configuration directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub tauri_version: &'static str,
    pub os: &'static str,
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

/// Helper function to load settings from disk, falling back to default settings if file read fails.
fn load_settings_from_disk(path: &PathBuf) -> AppSettings {
    if path.exists() {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(settings) = serde_json::from_str::<AppSettings>(&content) {
                return settings;
            }
        }
    }
    AppSettings::default()
}

/// Helper function to persist settings to disk asynchronously or synchronously on change.
fn save_settings_to_disk(path: &PathBuf, settings: &AppSettings) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = fs::write(path, json);
    }
}

/// Tauri IPC command: Retrieves current minimize-to-tray preference.
#[tauri::command]
fn get_minimize_to_tray(state: State<'_, AppState>) -> bool {
    state.settings.lock().unwrap().minimize_to_tray
}

/// Tauri IPC command: Updates current minimize-to-tray preference and persists to disk.
#[tauri::command]
fn set_minimize_to_tray(enabled: bool, state: State<'_, AppState>) {
    let mut settings = state.settings.lock().unwrap();
    settings.minimize_to_tray = enabled;
    save_settings_to_disk(&state.settings_path, &settings);
}

/// Tauri IPC command: Returns application and runtime system diagnostic information.
#[tauri::command]
fn get_app_info() -> AppInfo {
    AppInfo {
        name: "Minimalistic App",
        version: env!("CARGO_PKG_VERSION"),
        tauri_version: tauri::VERSION,
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    }
}

/// Toggles main window visibility: hides if visible, shows and focuses if hidden.
/// Extracted to eliminate code duplication between tray icon click and tray menu "Open" item.
fn toggle_window_visibility(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

/// Main entry point for Rust / Tauri backend application runtime.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            // Resolve OS-specific application configuration directory within an app-specific subfolder
            // (e.g., %APPDATA%\com.minimalistic.app\settings.json or ~/.config/com.minimalistic.app/settings.json)
            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| PathBuf::from("."));

            let settings_dir = if config_dir.to_string_lossy().contains("com.minimalistic.app")
                || config_dir.to_string_lossy().contains("Minimalistic App")
                || config_dir.to_string_lossy().contains("minimalistic-app")
            {
                config_dir
            } else {
                config_dir.join("Minimalistic App")
            };

            let settings_path = settings_dir.join("settings.json");
            let initial_settings = load_settings_from_disk(&settings_path);

            // Manage global application state container
            app.manage(AppState {
                settings: Mutex::new(initial_settings),
                settings_path,
                is_quitting: Mutex::new(false),
            });

            // Create native drop-down menu items for system tray icon
            let open_item = MenuItem::with_id(app, "open", "Open / Hide GUI", true, None::<&str>)?;
            let check_updates_item =
                MenuItem::with_id(app, "check_updates", "Check for Updates...", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_item, &check_updates_item, &quit_item])?;

            // Resolve app icon with clear error message if default icon is unconfigured
            let icon = app
                .default_window_icon()
                .expect("No default window icon found — ensure icons are configured in tauri.conf.json")
                .clone();

            // Initialize System Tray Icon with event routing
            let tray = TrayIconBuilder::new()
                .icon(icon)
                .tooltip("Minimalistic App")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        toggle_window_visibility(app);
                    }
                    "check_updates" => {
                        if let Some(window) = app.get_webview_window("main") {
                            if !window.is_visible().unwrap_or(false) {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        let _ = app.emit("check-for-updates", ());
                    }
                    "quit" => {
                        let state = app.state::<AppState>();
                        *state.is_quitting.lock().unwrap() = true;

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
                let is_quitting = *state.is_quitting.lock().unwrap();
                let minimize = state.settings.lock().unwrap().minimize_to_tray;

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

