//! Process entry point.
//!
//! Everything here has to happen *before* the Tauri runtime exists, which is
//! the only reason any of it lives outside `lib.rs`:
//!
//! 1. **Subsystem selection** — a compile-time attribute, not code.
//! 2. **Environment workarounds** — the webview reads these when it is created,
//!    so setting them later has no effect.
//! 3. **Argument parsing** — `--version` must print and exit without paying for
//!    a window, a webview, and a settings load.
//!
//! `run()` in `lib.rs` owns everything after that. Keeping `main` this thin is
//! also what lets the mobile entry point (`#[cfg_attr(mobile, …)]` on `run`)
//! work: mobile never calls `main` at all.

// Prevents an extra console window from appearing behind the app on Windows.
//
// The cost is that a release binary starts with no standard handles, so
// `println!` silently goes nowhere — which is why `cli::print_and_exit` has to
// attach to the parent console before writing `--help` or `--version` output.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use minimalistic_app_lib::cli;

/// Works around WebKitGTK's DMABUF renderer on drivers that do not support the
/// buffer formats it asks for — most often NVIDIA.
///
/// # Symptoms this avoids
///
/// A blank or white window, flicker while resizing, or a silent death on
/// resize, usually alongside
/// `AcceleratedSurfaceDMABuf was unable to construct a complete framebuffer`
/// in the console. See [tauri-apps/tauri#9394][issue] and the Tauri "Linux
/// Graphics Issues" guide.
///
/// # Why this is conditional
///
/// Tauri's own guidance is explicit: *"Only ship an unconditional override like
/// this if you have verified your app is affected. It disables a faster path
/// for everyone, including users on working setups."* Blanket-setting the
/// variable is the advice found in most issue threads and it makes every Linux
/// user pay for a bug some of them do not have.
///
/// So the fallback is narrowed to the configuration where the bug actually
/// lives, and left overridable:
///
/// * **A GPU must be present** (`/dev/dri` exists). No DRI, no DMABUF path, no
///   bug.
/// * **The session must be X11.** Wayland sessions use a different presentation
///   path; disabling DMABUF there costs performance for nothing.
/// * **The user must not have decided already.** An existing value of
///   `WEBKIT_DISABLE_DMABUF_RENDERER` — set by a distro package, a Flatpak
///   manifest, or a user who benchmarked it — always wins.
///
/// [issue]: https://github.com/tauri-apps/tauri/issues/9394
#[cfg(target_os = "linux")]
fn apply_linux_graphics_workarounds() {
    const DMABUF_VAR: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";

    // An explicit choice — including an explicit "0" — is never second-guessed.
    if std::env::var_os(DMABUF_VAR).is_some() {
        return;
    }

    let has_gpu_device = std::path::Path::new("/dev/dri").exists();
    let is_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
    let is_x11 = std::env::var("XDG_SESSION_TYPE").is_ok_and(|session| session == "x11");

    if has_gpu_device && is_x11 && !is_wayland {
        // SAFETY: single-threaded here — this runs as the first statement of
        // `main`, before any thread, window, or plugin exists, which is the
        // condition that makes `set_var` sound under Rust 2024 rules.
        unsafe { std::env::set_var(DMABUF_VAR, "1") };
        eprintln!(
            "[graphics] X11 session with a DRI device detected — setting {DMABUF_VAR}=1 to \
             avoid the WebKitGTK blank-window bug. Set it to 0 to keep the faster path."
        );
    }
}

/// No-op on Windows and macOS, which do not use WebKitGTK.
#[cfg(not(target_os = "linux"))]
fn apply_linux_graphics_workarounds() {}

fn main() {
    // Must precede webview creation, so it goes first.
    apply_linux_graphics_workarounds();

    // `--help` / `--version` exit here, before a window is ever considered.
    // Everything else is handed to `run()` and consumed during startup.
    let args = match cli::parse_env(
        minimalistic_app_lib::APP_DISPLAY_NAME,
        minimalistic_app_lib::APP_VERSION,
    ) {
        cli::Outcome::Run(args) => args,
        cli::Outcome::Exit { message, code } => cli::print_and_exit(&message, code),
    };

    minimalistic_app_lib::run(args);
}
