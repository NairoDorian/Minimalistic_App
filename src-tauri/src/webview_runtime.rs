//! Where the webview engine keeps *its* data — the half of portable mode that
//! is easy to miss.
//!
//! # The leak
//!
//! [`crate::portable`] redirects everything **this app** writes: settings, logs.
//! It has no effect on what the **webview engine** writes underneath it, and
//! that is not a small amount. On Windows, WebView2 creates an `EBWebView`
//! folder holding localStorage, IndexedDB, the HTTP cache, cookies, and
//! GPU shader caches. Left alone it lands in:
//!
//! ```text
//! %LOCALAPPDATA%\<bundle identifier>\EBWebView\
//! ```
//!
//! So an app advertised as "leaves no trace, run it from a USB stick" quietly
//! wrote the user's localStorage — which for this template includes the active
//! tab, theme and shortcut overrides — into the host machine's profile. Pull
//! the stick out and it is still there.
//!
//! # The fix, and why it is an environment variable
//!
//! WebView2's `CreateCoreWebView2EnvironmentWithOptions` takes a user-data
//! folder. wry passes the value from `WebContext`, which Tauri populates from
//! the window's `data_directory`. That route is unavailable here for a specific
//! reason: `data_directory` set in `tauri.conf.json` is resolved by Tauri
//! *relative to the OS local-data directory* (`tauri::webview::WebviewBuilder::
//! from_config` rejects an absolute path outright), so a declarative window can
//! never point outside the user profile. Only the Rust-side
//! `WebviewWindowBuilder::data_directory` accepts an absolute path, and using it
//! would mean giving up the declarative window in `tauri.conf.json` — a large
//! architectural change to fix one folder.
//!
//! When the host passes no folder, the WebView2 loader falls back to the
//! `WEBVIEW2_USER_DATA_FOLDER` environment variable before it computes its own
//! default. Setting that variable before the webview is created relocates the
//! whole profile with no change to how the window is declared.
//!
//! **This was verified empirically, not assumed**: with the variable set, the
//! `EBWebView` folder appears at the requested path and the default location's
//! copy is left untouched.
//!
//! # Platform coverage, stated honestly
//!
//! | Platform | Engine | Portable-clean? |
//! |----------|--------|-----------------|
//! | Windows  | WebView2 | Yes — this module |
//! | macOS    | WKWebView | No — see below |
//! | Linux    | WebKitGTK | No — see below |
//!
//! WKWebView stores its data under the app's sandbox container and offers
//! `dataStoreIdentifier` (a UUID, not a path) rather than a directory.
//! WebKitGTK writes to `$XDG_DATA_HOME/<identifier>` with no documented
//! override. Neither has an environment-variable equivalent, so on those two
//! platforms portable mode moves the app's own files and nothing more. Saying
//! so here is better than a template that implies a guarantee it cannot keep.

/// The WebView2 loader's documented override for the user-data folder.
#[cfg(target_os = "windows")]
const WEBVIEW2_USER_DATA_FOLDER: &str = "WEBVIEW2_USER_DATA_FOLDER";

/// Subdirectory created inside the portable data directory. Named after the
/// folder WebView2 would have created anyway, so someone browsing the portable
/// `Data/` folder recognizes what it is.
#[cfg(target_os = "windows")]
const WEBVIEW_DATA_DIR_NAME: &str = "EBWebView";

/// Points the webview engine's storage at the portable data directory.
///
/// Call **before** the Tauri builder — the environment is read when the webview
/// environment is created, which happens while the first window is being built,
/// well before `setup()` runs.
///
/// Three deliberate non-actions:
///
/// * **Normal (non-portable) mode does nothing.** The OS default location is
///   correct there, and hardcoding an equivalent path would only create a way
///   to disagree with it.
/// * **An existing `WEBVIEW2_USER_DATA_FOLDER` is never overwritten.** If an
///   operator set it — a locked-down deployment, a test harness — that is a
///   deliberate choice that outranks the marker file.
/// * **A failure is not fatal.** The worst case is the pre-existing behaviour.
#[cfg(target_os = "windows")]
pub fn init() {
    let Some(portable_dir) = crate::portable::data_dir() else {
        return;
    };

    if let Ok(existing) = std::env::var(WEBVIEW2_USER_DATA_FOLDER)
        && !existing.trim().is_empty()
    {
        // `println!` rather than `log::info!`: the logging plugin is registered
        // on the Tauri builder, which has not been assembled yet.
        println!(
            "[webview] {WEBVIEW2_USER_DATA_FOLDER} is already set to '{existing}' — \
             leaving it alone, webview data will not follow portable mode."
        );
        return;
    }

    let webview_dir = portable_dir.join(WEBVIEW_DATA_DIR_NAME);
    if let Err(err) = std::fs::create_dir_all(&webview_dir) {
        // Creating it up front is not strictly required — WebView2 creates the
        // folder itself — but failing here tells us the location is unusable
        // *before* the engine silently falls back to the user profile.
        println!(
            "[webview] Could not create {} ({err}) — webview data stays in the user profile.",
            webview_dir.display()
        );
        return;
    }

    // SAFETY: this runs on the main thread before any window, thread, or plugin
    // exists, so there is no concurrent reader of the environment. That is the
    // condition `set_var` is unsafe for in Rust 2024.
    unsafe { std::env::set_var(WEBVIEW2_USER_DATA_FOLDER, &webview_dir) };

    println!(
        "[webview] Portable mode — webview data directory: {}",
        webview_dir.display()
    );
}

/// No-op on platforms whose webview engine has no path override.
/// See the module docs for why this is a documented limitation rather than a
/// gap waiting to be filled.
#[cfg(not(target_os = "windows"))]
pub fn init() {}

#[cfg(test)]
mod tests {
    /// `init` reads process-global state (the portable `OnceLock` and the
    /// environment), so a unit test of it would either depend on test ordering
    /// or mutate the environment of every other test in the binary. The two
    /// behaviours worth pinning are structural, and both are checked here.
    #[test]
    #[cfg(target_os = "windows")]
    fn the_data_directory_is_named_after_the_engines_own_folder() {
        // If this ever changes, a user upgrading from an older portable copy
        // loses their localStorage without any migration. Pin the name.
        assert_eq!(super::WEBVIEW_DATA_DIR_NAME, "EBWebView");
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn the_override_variable_is_the_one_the_loader_reads() {
        // A typo here fails open — the app works, portable mode just leaks —
        // which is exactly the kind of bug that survives to production.
        assert_eq!(
            super::WEBVIEW2_USER_DATA_FOLDER,
            "WEBVIEW2_USER_DATA_FOLDER"
        );
    }

    /// Non-Windows builds still need one test so the module is not empty of
    /// coverage, and this documents the contract callers rely on.
    #[test]
    #[cfg(not(target_os = "windows"))]
    fn init_is_a_no_op_and_may_be_called_freely() {
        super::init();
        super::init();
    }
}
