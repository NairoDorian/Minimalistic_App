//! Make a crash leave evidence.
//!
//! # The problem
//!
//! Rust's default panic handler writes to **stderr**. A bundled desktop app has
//! no console: on Windows the binary is built with `windows_subsystem =
//! "windows"` precisely so no console window appears, and on macOS a `.app`
//! launched from Finder has nowhere for stderr to go. So the default handler
//! writes the one message that explains the crash into a stream nobody reads,
//! and the user's report is "it just closed".
//!
//! Two things make that worse here:
//!
//! * The release profile sets `panic = "abort"`. There is no unwinding, no
//!   `catch_unwind`, and no orderly shutdown — the process is gone the instant
//!   the hook returns. Whatever the hook does not record is lost.
//! * The global hotkey engine runs an OS keyboard hook on a **background
//!   thread**. A panic there is exactly the kind that never reaches a user-facing
//!   error boundary, because the UI thread is fine and the window stays open (or,
//!   under `abort`, the whole app vanishes with the window still on screen).
//!
//! # What this does
//!
//! Installs a hook that writes the panic through the `log` facade before the
//! process dies. Because `tauri-plugin-log` fans that out to stdout, the rotating
//! log file, and the webview, a crash now lands:
//!
//! * in `<app log dir>/<product>.log`, which survives the process and which the
//!   bug-report template already asks users to attach;
//! * in the in-app **Dev Console**, live, if the window is still up.
//!
//! The default handler is called afterwards, so behaviour under `cargo test` and
//! in a terminal is unchanged — this adds a destination, it does not replace one.

use std::panic::PanicHookInfo;

/// Formats a panic payload as a single log line.
///
/// Kept separate from the hook so the formatting is unit-testable: installing a
/// panic hook in a test would affect every other test in the binary.
fn describe(info: &PanicHookInfo<'_>) -> String {
    // The payload is `Box<dyn Any>`. `panic!("literal")` stores a `&str`, and
    // `panic!("{formatted}")` stores a `String`; anything else came from
    // `panic_any` and has no printable form.
    let message = info
        .payload()
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| info.payload().downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "<non-string panic payload>".to_string());

    let location = info
        .location()
        .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
        .unwrap_or_else(|| "<unknown location>".to_string());

    // The thread name is the most valuable field for this app: it distinguishes
    // a UI-thread panic from one on the keyboard-hook thread, which are very
    // different bugs.
    let thread = std::thread::current();
    let thread_name = thread.name().unwrap_or("<unnamed>");

    format!("[panic] thread '{thread_name}' panicked at {location}: {message}")
}

/// Installs the logging panic hook. Call once, as early in `run()` as possible.
///
/// Installing it before the logger is configured is fine and deliberate: the
/// `log` facade drops records until a logger is registered, so an early panic is
/// still better served by the default stderr handler that this chains to.
pub fn install() {
    let default_hook = std::panic::take_hook();

    std::panic::set_hook(Box::new(move |info| {
        // Log first. Under `panic = "abort"` the default hook is the last thing
        // that runs before the process dies, so anything after it is not
        // guaranteed to happen.
        log::error!("{}", describe(info));

        // Then behave exactly as before: stderr output, and `RUST_BACKTRACE`
        // handling, which this deliberately does not reimplement.
        default_hook(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::describe;
    use std::panic::PanicHookInfo;
    use std::sync::Mutex;

    /// Captures the description of a real panic without leaving a hook installed
    /// for the rest of the test binary.
    ///
    /// # Why this is serialized, and why that is not paranoia
    ///
    /// The panic hook is **process-global**, and `cargo test` runs tests on
    /// several threads by default. Two concurrent calls to this helper
    /// interleave into a genuinely broken state:
    ///
    /// ```text
    /// A: take_hook()  -> default        A installs hook A
    /// B: take_hook()  -> hook A         B installs hook B
    /// A: body panics                    hook B runs, B's slot is filled by A's panic
    /// A: set_hook(default)              hook B is now uninstalled, mid-flight
    /// B: body panics                    the default hook runs; nothing is captured
    /// B: .expect("hook must have run")  panics — inside whatever hook is current
    /// ```
    ///
    /// That last panic-inside-a-panic is not a test failure. It is
    /// `STATUS_STACK_BUFFER_OVERRUN` and the **entire test binary aborts**,
    /// taking every unrelated result with it and reporting a location that has
    /// nothing to do with the cause. It is also load-dependent, so it surfaces
    /// when someone adds tests elsewhere and looks like their fault.
    ///
    /// One process-wide lock removes the interleaving entirely. Poisoning is
    /// recovered from rather than unwrapped, for the same reason
    /// [`crate::lock_guard`] does it: the protected data is a plain `Option`
    /// that is valid whatever happened to the previous holder, and a second
    /// panic here would restart the cascade this lock exists to prevent.
    fn describe_panic(body: impl FnOnce() + std::panic::UnwindSafe) -> String {
        static SERIAL: Mutex<()> = Mutex::new(());
        static CAPTURED: Mutex<Option<String>> = Mutex::new(None);

        // Held for the whole swap-run-restore sequence. `catch_unwind` below
        // stops the body's panic before it can unwind through this frame, so
        // the guard is released normally and the lock is not poisoned.
        let _serial = SERIAL
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(|info: &PanicHookInfo<'_>| {
            let mut slot = CAPTURED
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *slot = Some(describe(info));
        }));

        let _ = std::panic::catch_unwind(body);

        // Restore before reading, so the `expect` below — which panics on a
        // genuine failure — is reported by the normal test harness hook rather
        // than by ours.
        std::panic::set_hook(previous);

        CAPTURED
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
            .expect("hook must have run")
    }

    #[test]
    fn describes_a_string_literal_panic() {
        let described = describe_panic(|| panic!("something went wrong"));

        assert!(described.contains("something went wrong"));
        assert!(
            described.contains("panic_log.rs"),
            "must name the source file"
        );
        assert!(described.contains("thread"), "must name the thread");
    }

    #[test]
    fn describes_a_formatted_panic() {
        let code = 42;
        let described = describe_panic(move || panic!("failed with code {code}"));

        assert!(described.contains("failed with code 42"));
    }

    #[test]
    fn describes_a_panic_from_a_named_background_thread() {
        // The case this module exists for: telling a hotkey-thread crash apart
        // from a UI-thread one.
        let described = std::thread::Builder::new()
            .name("hotkey-listener".to_string())
            .spawn(|| describe_panic(|| panic!("hook died")))
            .expect("spawn")
            .join()
            .expect("join");

        assert!(described.contains("hotkey-listener"));
        assert!(described.contains("hook died"));
    }

    #[test]
    fn survives_a_payload_that_is_not_a_string() {
        let described = describe_panic(|| std::panic::panic_any(7_u32));

        assert!(described.contains("<non-string panic payload>"));
    }
}
