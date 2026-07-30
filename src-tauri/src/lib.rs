use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State, WindowEvent,
};

/// Shared application state managed by Tauri state container.
/// Holds runtime user preferences and application lifecycle flags.
#[derive(Default)]
pub struct AppState {
    /// Controls whether closing the main GUI window minimizes the app to the system tray
    /// instead of terminating the application process. Default is true.
    pub minimize_to_tray: Mutex<bool>,

    /// Flag set to true when explicit application quit is triggered (e.g. via Tray menu).
    /// Used by `WindowEvent::CloseRequested` listener to bypass window close prevention.
    pub is_quitting: Mutex<bool>,
}

/// Tauri IPC command: Retrieves current minimize-to-tray preference.
#[tauri::command]
fn get_minimize_to_tray(state: State<'_, AppState>) -> bool {
    *state.minimize_to_tray.lock().unwrap()
}

/// Tauri IPC command: Updates current minimize-to-tray preference.
#[tauri::command]
fn set_minimize_to_tray(enabled: bool, state: State<'_, AppState>) {
    let mut minimize = state.minimize_to_tray.lock().unwrap();
    *minimize = enabled;
}

/// Main entry point for Rust / Tauri backend application runtime.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Register Tauri v2 Autostart Plugin for OS startup management
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::AppleScript,
            Some(vec!["--autostart"]),
        ))
        // Register Tauri v2 Store Plugin for persistent key-value storage
        .plugin(tauri_plugin_store::Builder::new().build())
        // Register Tauri v2 Process Plugin for app relaunch capability
        .plugin(tauri_plugin_process::init())
        // Register Tauri v2 Updater Plugin for GitHub Releases auto-updates
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Register managed state container with default preferences (minimize_to_tray: true)
        .manage(AppState {
            minimize_to_tray: Mutex::new(true),
            is_quitting: Mutex::new(false),
        })
        // Register IPC command handlers callable from React frontend
        .invoke_handler(tauri::generate_handler![
            get_minimize_to_tray,
            set_minimize_to_tray
        ])
        .setup(|app| {
            // Create native drop-down menu items for the taskbar system tray icon
            let open_item = MenuItem::with_id(app, "open", "Open / Hide GUI", true, None::<&str>)?;
            let check_updates_item = MenuItem::with_id(app, "check_updates", "Check for Updates...", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_item, &check_updates_item, &quit_item])?;

            // Initialize System Tray Icon with custom event routing
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        // Toggle main window visibility from menu click
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
                    "check_updates" => {
                        // Show main window and emit check-for-updates event to React frontend
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("check-for-updates", ());
                    }
                    "quit" => {
                        // Set quitting flag and close main window cleanly.
                        // Closing window triggers Win32 message loop teardown without WebView2 class unregistration errors.
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
                .on_tray_icon_event(|tray, event| {
                    // Left-click directly toggles show/hide for main window. Right-click opens native context menu.
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
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
                })
                .build(app)?;

            Ok(())
        })
        // Intercept window close requested event (X button click)
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let is_quitting = *state.is_quitting.lock().unwrap();
                let minimize = *state.minimize_to_tray.lock().unwrap();

                // If user didn't select Quit and minimize-to-tray is enabled, hide window to system tray instead of exiting
                if !is_quitting && minimize {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
