//! Stops a shipped build from behaving like a web browser.
//!
//! # The problem
//!
//! A Tauri app is a browser engine wearing an application's clothes, and the
//! engine keeps its own keyboard shortcuts. In a default release build:
//!
//! | Key | What the user expects | What actually happens |
//! |-----|----------------------|-----------------------|
//! | `F5`, `Ctrl+R` | nothing | the webview reloads — **all in-memory app state is lost** |
//! | `Ctrl+P` | nothing | a print dialog for the app's own UI |
//! | `Ctrl+F` | the app's find, if it has one | the engine's find bar draws over the app |
//! | `Ctrl+U` | nothing | "view source" |
//! | `Ctrl+±`, `Ctrl+0` | nothing | the entire UI zooms and the layout breaks |
//!
//! The reload is the one that hurts. Everything the user typed into an unsaved
//! form, every open panel, every bit of transient state is gone, and the app
//! looks like it crashed and restarted. Users find this by accident —
//! `Ctrl+R` is muscle memory from the browser next door.
//!
//! # Two halves, because one is not enough
//!
//! * **This module** turns the accelerators off at the engine level on Windows,
//!   via WebView2's `AreBrowserAcceleratorKeysEnabled`. That is the real fix:
//!   the keystrokes never become browser commands at all, so there is nothing
//!   for JavaScript to race with and nothing to miss when focus is inside an
//!   `<iframe>` or the webview has focus but the document does not.
//! * **`src/lib/hardening.ts`** does the same job in the frontend with
//!   `preventDefault`, which is the only option on macOS (WKWebView) and Linux
//!   (WebKitGTK) — neither exposes an accelerator switch. It also handles the
//!   things no engine flag covers, such as a dropped file navigating the
//!   webview away from the app.
//!
//! Keeping both is not redundancy for its own sake. The native switch covers
//! cases the DOM never sees; the DOM handler covers the platforms the native
//! switch does not exist on.
//!
//! # Why development builds are left alone
//!
//! `F5` and `Ctrl+Shift+I` are how you work on the frontend. Hardening a dev
//! build would mean restarting the app to see a CSS change. Every function here
//! is compiled out unless `debug_assertions` is off, so the cost in a dev build
//! is exactly zero and there is no runtime flag to forget to flip.
//!
//! Adapted from `webview_hardening.rs` in
//! [AIVORelay](https://github.com/MaxITService/AIVORelay).

/// Disables the browser's built-in accelerator keys for one window.
///
/// Call after the window exists — `setup()` is the natural place. Failures are
/// logged and swallowed: an app that refuses to start because it could not
/// disable `Ctrl+P` would be a worse bug than `Ctrl+P` working.
///
/// # Version coupling
///
/// `webview2-com` and `windows-core` must be the same major versions Tauri and
/// wry link, because [`tauri::webview::PlatformWebview::controller`] hands back
/// *their* `ICoreWebView2Controller`. A mismatch shows up as
/// "no method named `cast`" or a type error on the controller — check what
/// `tauri`'s own `Cargo.toml` requires before bumping either.
#[cfg(all(target_os = "windows", not(debug_assertions)))]
pub fn disable_browser_accelerator_keys(window: &tauri::WebviewWindow) {
    // The closure runs on the UI thread and must own everything it touches, so
    // the label is copied for the log message rather than borrowed.
    let label = window.label().to_string();

    let dispatch_result = window.with_webview(move |webview| {
        // SAFETY: every call below is a COM method on an interface obtained
        // from the live controller, invoked on the UI thread that owns it.
        // `with_webview` is what guarantees that thread affinity.
        unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
            use windows_core::Interface;

            // ICoreWebView2Settings3 is the interface that carries the
            // accelerator switch; older runtimes only implement Settings2, so
            // `cast` is a genuine runtime query, not a formality. It fails
            // gracefully on a WebView2 runtime too old to have it.
            let result = webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.Settings())
                .and_then(|settings| settings.cast::<ICoreWebView2Settings3>())
                .and_then(|settings| settings.SetAreBrowserAcceleratorKeysEnabled(false));

            match result {
                Ok(()) => log::debug!(
                    "[hardening] Browser accelerator keys disabled for window '{label}'"
                ),
                Err(err) => log::warn!(
                    "[hardening] Could not disable browser accelerator keys for '{label}': {err} \
                     — the frontend guard in src/lib/hardening.ts still applies."
                ),
            }
        }
    });

    if let Err(err) = dispatch_result {
        log::warn!(
            "[hardening] Could not reach the WebView2 instance for '{}': {err}",
            window.label()
        );
    }
}

/// No-op in development builds and on platforms without an accelerator switch.
///
/// The parameter keeps the call site identical everywhere, so `lib.rs` never
/// needs a `#[cfg]` of its own — see the module docs for why macOS and Linux
/// rely on the frontend guard instead.
#[cfg(not(all(target_os = "windows", not(debug_assertions))))]
pub fn disable_browser_accelerator_keys(_window: &tauri::WebviewWindow) {}

#[cfg(test)]
mod tests {
    /// The behaviour worth testing here is "does WebView2 stop reloading on
    /// F5", which needs a real window and a real keystroke — an end-to-end
    /// concern, not a unit-test one. What *can* be pinned is the property that
    /// makes the call sites safe: the function exists with the same signature
    /// in every configuration, so no caller needs a `#[cfg]`.
    #[test]
    fn the_entry_point_is_callable_in_every_build_configuration() {
        let hardener: fn(&tauri::WebviewWindow) = super::disable_browser_accelerator_keys;
        // Referencing it is the assertion: this line does not compile if the
        // real and no-op variants ever disagree about their signature, or if
        // the `#[cfg]` predicates leave some configuration with neither.
        let _ = hardener;
    }
}
