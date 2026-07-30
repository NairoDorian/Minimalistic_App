use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};

/// Shared application state managed by Tauri state container.
/// Holds runtime user preferences and application lifecycle flags.
pub struct AppState {
    /// Controls whether closing the main GUI window minimizes the app to the system tray
    /// instead of terminating the application process. Default is false.
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
    *state.minimize_to_tray.lock().unwrap() = enabled;
}

/// Toggles main window visibility: hides if visible, shows and focuses if hidden.
/// Extracted to eliminate copy-paste between the tray icon click and the menu "Open" item.
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
        // MacosLauncher::AppleScript is a macOS-specific enum variant — on Windows and Linux
        // the launcher type is ignored by the plugin and OS-native startup is used instead.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::AppleScript,
            Some(vec!["--autostart"]),
        ))
        // Register Tauri v2 Process Plugin for app relaunch capability (used by auto-updater)
        .plugin(tauri_plugin_process::init())
        // Register Tauri v2 Updater Plugin for GitHub Releases auto-updates
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Register managed state container with explicit defaults:
        //   minimize_to_tray = false (quit on window close by default)
        //   is_quitting      = false (not quitting until tray Quit is clicked)
        .manage(AppState {
            minimize_to_tray: Mutex::new(false),
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

            // Resolve app icon. Using expect() here rather than unwrap() so that a missing
            // icon file at build time produces a clear, descriptive panic message instead of a
            // cryptic index-out-of-bounds or None unwrap.
            let icon = app
                .default_window_icon()
                .expect("No default window icon found — ensure icons are configured in tauri.conf.json")
                .clone();

            // Initialize System Tray Icon with custom event routing.
            // The handle MUST be kept alive for the duration of the process — dropping it removes the tray icon.
            let tray = TrayIconBuilder::new()
                .icon(icon)
                .tooltip("Minimalistic App")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        // Toggle main window visibility from menu click
                        toggle_window_visibility(app);
                    }
                    "check_updates" => {
                        // Show main window only if currently hidden, then emit event to React frontend.
                        // If the window is already visible and focused, leave it undisturbed.
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
                .on_tray_icon_event(|tray_icon, event| {
                    // Left-click directly toggles show/hide for main window. Right-click opens native context menu.
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

            // Keep the tray handle alive for the entire process lifetime.
            // Without this, the tray icon is dropped and disappears immediately.
            app.manage(tray);

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
