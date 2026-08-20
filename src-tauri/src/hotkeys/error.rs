//! Error type for the global-hotkey subsystem.
//!
//! Hand-written rather than derived with `thiserror`: the enum is small and
//! closed, so implementing `Display` directly keeps this module free of
//! dependencies beyond the OS bindings. `Display` is what the Tauri IPC layer
//! surfaces, so every message is written to be shown to a user — in particular
//! the permission errors, which tell the user exactly what to grant and where.

use std::fmt;

use crate::hotkeys::types::HotkeyId;

#[derive(Debug)]
pub enum Error {
    /// An OS call failed while opening or reading a device.
    Io(std::io::Error),

    /// macOS: the app is not trusted for Accessibility, so no event tap can be
    /// created. The user must grant it in System Settings.
    AccessibilityNotGranted,

    /// macOS: `CGEvent.tapCreate` failed for a reason other than permissions.
    EventTapCreationFailed(String),

    /// Linux: `/dev/input` is readable but `/dev/uinput` is not, so matched
    /// hotkeys can be detected but not blocked from other applications.
    BlockingUnavailable(String),

    HotkeyNotFound(HotkeyId),
    HotkeyAlreadyRegistered(String),

    /// The listener thread is not running (stopped, or never started).
    EventLoopNotRunning,

    /// `recv_timeout` elapsed with no event — an expected, non-fatal outcome.
    Timeout,

    /// A backend failed in a platform-specific way.
    Platform(String),

    EmptyHotkey,
    InvalidHotkeyFormat(String),
    UnknownKey(String),
    UnknownModifier(String),

    /// A lock was poisoned by a panic in another thread.
    MutexPoisoned,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Io(err) => write!(f, "I/O error: {err}"),
            Error::AccessibilityNotGranted => write!(
                f,
                "Accessibility permission not granted. Enable it in System Settings > \
                 Privacy & Security > Accessibility, then restart the app."
            ),
            Error::EventTapCreationFailed(detail) => {
                write!(f, "Failed to create the keyboard event tap: {detail}")
            }
            Error::BlockingUnavailable(detail) => write!(
                f,
                "Global hotkeys can be detected but not blocked: {detail}"
            ),
            Error::HotkeyNotFound(id) => write!(f, "Hotkey {id:?} is not registered"),
            Error::HotkeyAlreadyRegistered(hotkey) => {
                write!(f, "Hotkey already registered: {hotkey}")
            }
            Error::EventLoopNotRunning => write!(f, "The keyboard listener is not running"),
            Error::Timeout => write!(f, "Timed out waiting for a keyboard event"),
            Error::Platform(detail) => write!(f, "Keyboard backend error: {detail}"),
            Error::EmptyHotkey => write!(f, "A hotkey needs at least one modifier or a key"),
            Error::InvalidHotkeyFormat(detail) => write!(f, "Invalid hotkey: {detail}"),
            Error::UnknownKey(token) => write!(f, "Unknown key: \"{token}\""),
            Error::UnknownModifier(token) => write!(f, "Unknown modifier: \"{token}\""),
            Error::MutexPoisoned => write!(f, "Internal error: a keyboard lock was poisoned"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Io(err) => Some(err),
            _ => None,
        }
    }
}

impl From<std::io::Error> for Error {
    fn from(err: std::io::Error) -> Self {
        Error::Io(err)
    }
}

/// Lets IPC commands surface a hotkey failure with `?` — Tauri commands in this
/// app return `Result<_, String>` so the message reaches the UI verbatim.
impl From<Error> for String {
    fn from(err: Error) -> Self {
        err.to_string()
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_are_user_facing_and_non_empty() {
        let errors = [
            Error::AccessibilityNotGranted,
            Error::EventTapCreationFailed("tap".into()),
            Error::BlockingUnavailable("/dev/uinput".into()),
            Error::HotkeyNotFound(HotkeyId(7)),
            Error::HotkeyAlreadyRegistered("Ctrl+K".into()),
            Error::EventLoopNotRunning,
            Error::Timeout,
            Error::Platform("hook".into()),
            Error::EmptyHotkey,
            Error::InvalidHotkeyFormat("two keys".into()),
            Error::UnknownKey("zzz".into()),
            Error::UnknownModifier("zzz".into()),
            Error::MutexPoisoned,
        ];
        for err in errors {
            let text = err.to_string();
            assert!(!text.is_empty());
            // No Debug-style formatting leaking into user-facing text.
            assert!(!text.contains("Error::"), "{text}");
        }
    }

    #[test]
    fn io_errors_convert_and_keep_their_source() {
        let err: Error = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied").into();
        assert!(err.to_string().contains("denied"));
        assert!(std::error::Error::source(&err).is_some());
    }

    #[test]
    fn converts_into_the_ipc_string_error() {
        let message: String = Error::Timeout.into();
        assert_eq!(message, Error::Timeout.to_string());
    }
}
