//! Cross-platform **global** keyboard shortcuts — hotkeys that fire even when
//! the app is not focused.
//!
//! Vendored from the MIT-licensed [`handy-keys`](https://github.com/handy-computer/handy-keys)
//! crate (see `THIRD_PARTY_LICENSES.md`) and embedded here so the template owns
//! the whole stack with no hotkey dependency to track.
//!
//! # Layout
//!
//! - [`types`] — `Modifiers` (side-aware bitflags), `Key`, `Hotkey`, and the
//!   string grammar (`"Ctrl+Alt+Space"`, `"Cmd+Shift"`, `"F5"`).
//! - [`platform`] — the OS hooks: `CGEventTap` on macOS, `WH_KEYBOARD_LL` on
//!   Windows, and evdev (+ uinput re-injection) on Linux.
//! - [`listener`] — [`KeyboardListener`], a raw key-event stream used for
//!   "record a hotkey" flows.
//! - [`manager`] — [`HotkeyManager`], which filters that stream against
//!   registered hotkeys and emits press/release events.
//!
//! # Local additions on top of upstream
//!
//! - `Modifiers` accepts `Mod` / `CmdOrCtrl` / `CommandOrControl`, resolving to
//!   ⌘ on macOS and Ctrl elsewhere, so one persisted spec string is portable
//!   across machines and matches the frontend engine in `src/lib/keyboard.ts`.
//!
//! # Platform requirements
//!
//! | OS      | Requirement                                                        |
//! | :------ | :----------------------------------------------------------------- |
//! | Windows | None — low-level keyboard hook.                                     |
//! | macOS   | Accessibility permission (see [`check_accessibility`]).             |
//! | Linux   | Read access to `/dev/input/event*`; blocking also needs `/dev/uinput`. |
//!
//! See `src-tauri/src/global_hotkeys.rs` for how the app drives this.

pub mod error;
pub mod listener;
pub mod manager;
pub mod platform;
pub mod types;

pub use error::{Error, Result};
pub use listener::{BlockingHotkeys, KeyboardListener};
pub use manager::HotkeyManager;
pub use types::{Hotkey, HotkeyEvent, HotkeyId, HotkeyState, Key, KeyEvent, Modifiers};

#[cfg(target_os = "macos")]
pub use platform::macos::{check_accessibility, open_accessibility_settings};
