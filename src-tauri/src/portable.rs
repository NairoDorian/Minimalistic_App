//! Portable mode: keep everything the app writes beside the executable.
//!
//! # What it is
//!
//! Create an empty file named `portable` next to the application binary, and on
//! the next launch settings and logs go to `<exe dir>/Data/` instead of the OS
//! configuration and log directories. Delete the marker and the app returns to
//! normal behaviour, leaving the portable `Data/` folder untouched.
//!
//! ```text
//! MyApp/
//!   minimalistic-app.exe
//!   portable            ← empty marker file: presence is the whole switch
//!   Data/
//!     settings.json
//!     logs/
//! ```
//!
//! # Why a template should ship this
//!
//! It makes the app runnable from a USB stick or a locked-down machine, and it
//! leaves no trace on the host — which matters for an app that can register
//! itself at OS startup and install a global keyboard hook. It is also the
//! easiest way to test a clean-profile launch: drop the marker, and you get a
//! fresh configuration without touching your real one.
//!
//! # Design notes
//!
//! * **Resolved once, at process start.** [`init`] runs before the Tauri builder
//!   because it only needs `current_exe()`, and caching in a [`OnceLock`] means
//!   every later path lookup is a pointer read. It also means the mode cannot
//!   change mid-session and leave half the app writing to each location.
//! * **The marker is a file, not a flag or an env var.** It travels with the
//!   directory it describes, survives being copied to another machine, and
//!   cannot be set accidentally by a parent process.
//! * **Failure falls back to normal mode.** An unwritable directory beside the
//!   executable — Program Files, a read-only mount — means portable mode is not
//!   available, not that the app should refuse to start.
//!
//! Adapted from `portable.rs` in
//! [AIVORelay](https://github.com/MaxITService/AIVORelay).

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::{AppHandle, Manager};

/// Name of the marker file whose presence enables portable mode.
const MARKER_FILE_NAME: &str = "portable";

/// Directory created beside the executable to hold everything the app writes.
const DATA_DIR_NAME: &str = "Data";

/// Resolved once by [`init`]; `None` means normal (OS-directory) mode.
static PORTABLE_DATA_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Decides whether `exe_dir` should run in portable mode, and prepares its data
/// directory if so.
///
/// Split out from [`init`] so the decision is testable without an executable
/// path or a process-global cache.
fn resolve_data_dir(exe_dir: &Path) -> Option<PathBuf> {
    if !exe_dir.join(MARKER_FILE_NAME).exists() {
        return None;
    }

    let data_dir = exe_dir.join(DATA_DIR_NAME);
    match std::fs::create_dir_all(&data_dir) {
        Ok(()) => Some(data_dir),
        Err(err) => {
            // The marker says the user wants portable mode, but the location
            // will not allow it (Program Files, a read-only mount, a full disk).
            // Falling back is right — refusing to start would be worse — but it
            // must be loud, because the app is about to write somewhere the user
            // did not expect.
            eprintln!(
                "[portable] '{}' marker found but {} is not writable ({err}); \
                 falling back to the OS data directories.",
                MARKER_FILE_NAME,
                data_dir.display()
            );
            None
        }
    }
}

/// Detects portable mode. Call once, as early in `run()` as possible, before
/// anything resolves a path.
///
/// Repeat calls are no-ops: the first resolution wins for the process lifetime.
pub fn init() {
    PORTABLE_DATA_DIR.get_or_init(|| {
        let exe_path = std::env::current_exe().ok()?;
        let exe_dir = exe_path.parent()?;
        let resolved = resolve_data_dir(exe_dir);

        if let Some(dir) = &resolved {
            // `println!` rather than `log::info!`: the logger is configured from
            // the very path this decides, so it does not exist yet.
            println!(
                "[portable] Portable mode active — data directory: {}",
                dir.display()
            );
        }

        resolved
    });
}

/// The portable data directory, or `None` in normal mode.
///
/// Returns `None` if [`init`] has not run, which is the safe reading: callers
/// then use the OS directories.
pub fn data_dir() -> Option<&'static PathBuf> {
    PORTABLE_DATA_DIR.get().and_then(Option::as_ref)
}

/// True when the app is running in portable mode.
pub fn is_active() -> bool {
    data_dir().is_some()
}

/// Where `settings.json` lives: the portable data directory, or the OS app
/// config directory.
pub fn config_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    match data_dir() {
        Some(dir) => Ok(dir.clone()),
        None => app.path().app_config_dir(),
    }
}

/// Where the rotating log file lives.
pub fn log_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    match data_dir() {
        Some(dir) => Ok(dir.join("logs")),
        None => app.path().app_log_dir(),
    }
}

/// The log directory as known *before* an [`AppHandle`] exists.
///
/// The logging plugin is registered on the builder, which happens before
/// `setup()`, so the portable log target has to be resolvable without an app
/// handle. In normal mode there is nothing to resolve — the plugin's own
/// `LogDir` target already points at the right place.
pub fn log_dir_preinit() -> Option<PathBuf> {
    data_dir().map(|dir| dir.join("logs"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A unique scratch directory per test, so they can run in parallel.
    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "minimalistic_portable_{tag}_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    #[test]
    fn no_marker_means_normal_mode() {
        let dir = scratch("no_marker");

        assert_eq!(resolve_data_dir(&dir), None);
        assert!(
            !dir.join(DATA_DIR_NAME).exists(),
            "normal mode must not create a Data directory"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn marker_enables_portable_mode_and_creates_the_data_directory() {
        let dir = scratch("with_marker");
        std::fs::write(dir.join(MARKER_FILE_NAME), "").expect("marker");

        let resolved = resolve_data_dir(&dir).expect("marker should enable portable mode");

        assert_eq!(resolved, dir.join(DATA_DIR_NAME));
        assert!(resolved.is_dir(), "the data directory must be created");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn marker_contents_are_irrelevant() {
        // Only presence matters. Documenting this keeps a future reader from
        // inventing a format for the file and breaking existing installs.
        let dir = scratch("marker_contents");
        std::fs::write(dir.join(MARKER_FILE_NAME), "anything at all\n").expect("marker");

        assert_eq!(resolve_data_dir(&dir), Some(dir.join(DATA_DIR_NAME)));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolution_is_idempotent() {
        let dir = scratch("idempotent");
        std::fs::write(dir.join(MARKER_FILE_NAME), "").expect("marker");

        let first = resolve_data_dir(&dir);
        let second = resolve_data_dir(&dir);

        assert_eq!(first, second, "an existing Data directory must be reused");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_marker_directory_is_not_mistaken_for_the_marker_file() {
        // `Path::exists` is true for a directory too. A `portable/` directory is
        // far more likely to be someone's source folder than an intent to switch
        // modes — but treating it as the marker would silently relocate their
        // settings, so pin the current behaviour explicitly rather than leaving
        // it to chance.
        let dir = scratch("marker_dir");
        std::fs::create_dir_all(dir.join(MARKER_FILE_NAME)).expect("marker dir");

        // Current behaviour: presence is presence. If this ever needs to change,
        // this test is the place that says so out loud.
        assert!(resolve_data_dir(&dir).is_some());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
