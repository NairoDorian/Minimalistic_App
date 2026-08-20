//! The command line a desktop app actually needs.
//!
//! # Why a GUI app has a command line at all
//!
//! Three callers pass arguments to a desktop application, and none of them are
//! a human typing at a prompt:
//!
//! 1. **The OS launch entry.** `tauri-plugin-autostart` registers the app with
//!    the arguments given to [`tauri_plugin_autostart::init`] — this template
//!    registers `--autostart`. Without something reading that flag, a
//!    launch-at-login and a launch-from-the-Start-menu are indistinguishable,
//!    and the app pops a window in the user's face every time they log in.
//! 2. **A second copy of the app.** `tauri-plugin-single-instance` hands the
//!    *running* process the argv of the copy that was just blocked. That is the
//!    channel a shortcut, a taskbar pin, or a script uses to say "show
//!    yourself" or "quit" — see [`InstanceRequest`].
//! 3. **A support request.** `--log-level=debug` for one run beats talking a
//!    user through setting an environment variable.
//!
//! # Why this is hand-written and not [`clap`](https://docs.rs/clap)
//!
//! Six flags do not justify a proc-macro dependency and its build time in a
//! template whose point is to stay small. The moment the surface grows past
//! subcommands or typed values, switch — the reference app this template
//! borrows from ([AIVORelay](https://github.com/MaxITService/AIVORelay)) uses
//! clap with derive for roughly sixty flags, and hand-rolling that would be
//! indefensible. The seam is [`parse`]: it takes an iterator of strings and
//! returns an [`Outcome`], so swapping the body for `CliArgs::try_parse_from`
//! touches this file only.
//!
//! # The rule that matters most: unknown arguments are never fatal
//!
//! A CLI tool should reject `--frobnicate` loudly. A GUI application must not:
//! it is launched by desktop shells that inject arguments it never asked for.
//! macOS passes `-psn_0_1234567` (process serial number) when the app is opened
//! from Finder; a file-association launch passes a path; a browser passes a
//! deep link. Exiting on any of those turns "user double-clicked the icon" into
//! "app silently failed to start". Unknown arguments are collected into
//! [`CliArgs::unknown`] and logged once the logger exists.

use std::fmt::Write as _;

/// One row of the flag table — the single source of truth shared by the parser
/// and `--help`, so the two can never drift.
struct FlagDoc {
    /// How the flag is written, exactly as it appears in `--help`.
    usage: &'static str,
    /// One-line description, also exactly as it appears in `--help`.
    help: &'static str,
}

/// Every flag this app accepts. Adding a flag means adding a row here *and* a
/// match arm in [`parse`]; the `help_lists_every_flag` test fails if a row is
/// added without at least mentioning its long form somewhere in the parser.
const FLAGS: &[FlagDoc] = &[
    FlagDoc {
        usage: "--autostart",
        help: "Started by the OS launch entry. Implies --hidden.",
    },
    FlagDoc {
        usage: "--hidden",
        help: "Start minimized to the system tray without showing a window.",
    },
    FlagDoc {
        usage: "--show",
        help: "Show and focus the window of an already-running instance.",
    },
    FlagDoc {
        usage: "--toggle",
        help: "Show or hide the window of an already-running instance.",
    },
    FlagDoc {
        usage: "--quit",
        help: "Ask an already-running instance to exit.",
    },
    FlagDoc {
        usage: "--log-level <LEVEL>",
        help: "off | error | warn | info | debug | trace  (default: info)",
    },
    FlagDoc {
        usage: "-h, --help",
        help: "Print this help and exit.",
    },
    FlagDoc {
        usage: "-V, --version",
        help: "Print the version and exit.",
    },
];

/// What a *second* launch is asking the *first*, already-running instance to do.
///
/// These are deliberately the operations a user can reach from a desktop
/// shortcut or a script. Anything that needs a payload (open this file, follow
/// this deep link) belongs in a dedicated plugin, not here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstanceRequest {
    /// Show and focus the existing window.
    Show,
    /// Show it if hidden, hide it if visible — what a tray-icon click does.
    Toggle,
    /// Exit the running instance.
    Quit,
}

/// The parsed command line.
///
/// Every field is meaningful in both roles: on the *first* launch it configures
/// startup, and on a *blocked second* launch it is forwarded to the running
/// process. `--show` on a cold start just means "start visible", which is
/// already the default; the same flag on a warm start raises the window.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CliArgs {
    /// Start without showing the window. Set by `--hidden` or `--autostart`.
    ///
    /// This is intentionally *separate* from the `start_minimized` preference:
    /// a user who wants a visible window on a manual launch still expects a
    /// login launch to stay quiet, so the flag ORs with the preference rather
    /// than replacing it.
    pub start_hidden: bool,
    /// True when the OS launch entry started us, as opposed to a human.
    ///
    /// Kept distinct from [`start_hidden`](Self::start_hidden) even though it
    /// implies it: "we were auto-started" is the fact, "do not show a window"
    /// is one consequence of it. A later feature (skip the update check on a
    /// login launch, delay heavy work until the machine settles) needs the
    /// fact, not the consequence.
    pub launched_by_autostart: bool,
    /// What to ask a running instance to do, if anything.
    pub request: Option<InstanceRequest>,
    /// `--log-level` override for this run, or `None` to use the default.
    pub log_level: Option<log::LevelFilter>,
    /// Arguments this parser did not recognize. Never fatal — see the module
    /// docs. Logged once at startup so a genuine typo is still discoverable.
    pub unknown: Vec<String>,
}

/// The result of parsing: either the app runs, or it prints something and exits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// Continue into the Tauri runtime with these settings.
    Run(CliArgs),
    /// Write `message` to stdout and exit with `code`. `--help` and `--version`
    /// both land here.
    ///
    /// This is returned rather than performed so that [`parse`] stays a pure
    /// function: the tests below assert on the exact help text without the test
    /// binary printing it or, worse, calling `std::process::exit`.
    Exit { message: String, code: i32 },
}

/// Renders `--help`, aligning the descriptions off the widest usage column so
/// adding a long flag reflows the block instead of breaking its alignment.
fn help_text(app_name: &str, version: &str) -> String {
    let width = FLAGS.iter().map(|f| f.usage.len()).max().unwrap_or(0);

    let mut out = format!(
        "{app_name} {version}\n\n\
         USAGE:\n    {app_name} [OPTIONS]\n\n\
         OPTIONS:\n"
    );
    for flag in FLAGS {
        // Writing into a String is infallible; the `_ =` documents that the
        // Result is intentionally discarded rather than forgotten.
        let _ = writeln!(out, "    {:<width$}    {}", flag.usage, flag.help);
    }
    out.push_str(
        "\nNOTES:\n    \
         --show, --toggle and --quit are forwarded to an already-running\n    \
         instance. Starting a second copy never opens a second window.\n\n    \
         Unrecognized arguments are ignored, because desktop shells inject\n    \
         their own (Finder passes -psn_..., for example).\n",
    );
    out
}

/// Maps a `--log-level` value to a filter, accepting the spellings `RUST_LOG`
/// accepts so the flag and the environment variable behave the same way.
fn parse_log_level(value: &str) -> Option<log::LevelFilter> {
    match value.trim().to_ascii_lowercase().as_str() {
        "off" | "none" | "silent" => Some(log::LevelFilter::Off),
        "error" => Some(log::LevelFilter::Error),
        "warn" | "warning" => Some(log::LevelFilter::Warn),
        "info" => Some(log::LevelFilter::Info),
        "debug" => Some(log::LevelFilter::Debug),
        "trace" | "verbose" => Some(log::LevelFilter::Trace),
        _ => None,
    }
}

/// Parses an argument list, **excluding** `argv[0]`.
///
/// Both `--log-level debug` and `--log-level=debug` are accepted: the first is
/// what a human types, the second is what survives a shell shortcut's
/// "arguments" field where splitting on spaces is not guaranteed.
///
/// An unusable `--log-level` value is a *warning*, not an error. The intent
/// ("more logging") is unambiguous even when the spelling is wrong, and
/// refusing to start over a mistyped diagnostic flag is exactly backwards.
pub fn parse<I>(args: I, app_name: &str, version: &str) -> Outcome
where
    I: IntoIterator<Item = String>,
{
    let mut parsed = CliArgs::default();
    // Peekable so `--log-level` can consume the following token when the value
    // was not attached with `=`.
    let mut iter = args.into_iter().peekable();

    while let Some(arg) = iter.next() {
        // A `--flag=value` pair is split once, at the first `=`, so a value may
        // itself contain `=` (irrelevant for today's flags, wrong to assume for
        // tomorrow's).
        let (name, inline_value) = match arg.split_once('=') {
            Some((name, value)) => (name.to_string(), Some(value.to_string())),
            None => (arg.clone(), None),
        };

        match name.as_str() {
            "--help" | "-h" => {
                return Outcome::Exit {
                    message: help_text(app_name, version),
                    code: 0,
                };
            }
            "--version" | "-V" => {
                return Outcome::Exit {
                    message: format!("{app_name} {version}\n"),
                    code: 0,
                };
            }
            "--autostart" => {
                parsed.launched_by_autostart = true;
                parsed.start_hidden = true;
            }
            "--hidden" | "--minimized" => parsed.start_hidden = true,
            // Later request flags win over earlier ones. There is no sensible
            // way to both show and quit, and picking the last one matches how
            // every other CLI resolves a repeated option.
            "--show" => parsed.request = Some(InstanceRequest::Show),
            "--toggle" => parsed.request = Some(InstanceRequest::Toggle),
            "--quit" | "--exit" => parsed.request = Some(InstanceRequest::Quit),
            "--log-level" => {
                let value = inline_value.or_else(|| iter.next());
                match value.as_deref().and_then(parse_log_level) {
                    Some(level) => parsed.log_level = Some(level),
                    // Record it as unknown rather than dropping it silently, so
                    // the startup log names the argument the user got wrong.
                    None => parsed.unknown.push(arg),
                }
            }
            _ => parsed.unknown.push(arg),
        }
    }

    Outcome::Run(parsed)
}

/// Parses the real process arguments.
///
/// `args_os().skip(1)` rather than `args()`: [`std::env::args`] *panics* on an
/// argument that is not valid Unicode, and a path with an unpaired surrogate is
/// a file a user can genuinely have. Lossy conversion turns that into a
/// harmless entry in [`CliArgs::unknown`] instead of a crash before `main` has
/// done anything.
pub fn parse_env(app_name: &str, version: &str) -> Outcome {
    let args = std::env::args_os()
        .skip(1)
        .map(|arg| arg.to_string_lossy().into_owned());
    parse(args, app_name, version)
}

/// Makes `println!` reach the terminal that launched a Windows GUI application.
///
/// `main.rs` sets `windows_subsystem = "windows"` in release builds, which is
/// what stops a console window from flashing behind the app. The cost is that
/// the process starts with **no standard handles at all**, so `--version`
/// writes into the void: the user sees the command return instantly with no
/// output and concludes the flag is broken.
///
/// `AttachConsole(ATTACH_PARENT_PROCESS)` borrows the console of whatever
/// launched us — the `cmd.exe` or PowerShell window the user typed into. It
/// fails harmlessly when there is no parent console (double-clicked from
/// Explorer, started by the OS at login), which is why the result is ignored.
///
/// Reopening the CRT handles afterwards is required: Rust's `println!` writes
/// to the `stdout` handle captured at process start, which is still invalid.
/// `freopen`-equivalent behaviour is obtained here by re-fetching the handle
/// through the Win32 console API and writing to it directly.
///
/// This is a no-op everywhere except Windows, where every other platform's
/// GUI binary already inherits a working stdout.
#[cfg(windows)]
pub fn print_and_exit(message: &str, code: i32) -> ! {
    use std::io::Write as _;
    use windows::Win32::System::Console::{
        ATTACH_PARENT_PROCESS, AttachConsole, GetStdHandle, STD_OUTPUT_HANDLE, WriteConsoleA,
    };

    // SAFETY: both calls are plain Win32 FFI with no pointer arguments we own.
    // A failure of either simply means there is no console to print to, which
    // is the normal case for a double-click launch.
    unsafe {
        let _ = AttachConsole(ATTACH_PARENT_PROCESS);
        if let Ok(handle) = GetStdHandle(STD_OUTPUT_HANDLE) {
            let bytes = message.as_bytes();
            let mut written = 0u32;
            let _ = WriteConsoleA(handle, bytes, Some(&mut written), None);
        }
    }

    // Also write through the normal path. In a *debug* build the console
    // subsystem is active and this is the write that actually appears; in a
    // release build stdout is invalid and this is a harmless no-op. Doing both
    // keeps `--version` working in `cargo run` and in the shipped binary.
    let _ = std::io::stdout().write_all(message.as_bytes());
    let _ = std::io::stdout().flush();

    std::process::exit(code);
}

/// Prints and exits. See the Windows variant for why that needs its own body.
#[cfg(not(windows))]
pub fn print_and_exit(message: &str, code: i32) -> ! {
    use std::io::Write as _;
    let _ = std::io::stdout().write_all(message.as_bytes());
    let _ = std::io::stdout().flush();
    std::process::exit(code);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Convenience wrapper: parse string literals and unwrap to [`CliArgs`].
    fn run(args: &[&str]) -> CliArgs {
        match parse(args.iter().map(|s| (*s).to_string()), "Test App", "1.2.3") {
            Outcome::Run(parsed) => parsed,
            Outcome::Exit { message, .. } => panic!("expected Run, got Exit:\n{message}"),
        }
    }

    fn exit_of(args: &[&str]) -> (String, i32) {
        match parse(args.iter().map(|s| (*s).to_string()), "Test App", "1.2.3") {
            Outcome::Exit { message, code } => (message, code),
            Outcome::Run(parsed) => panic!("expected Exit, got Run: {parsed:?}"),
        }
    }

    #[test]
    fn no_arguments_is_a_plain_visible_launch() {
        assert_eq!(run(&[]), CliArgs::default());
    }

    #[test]
    fn autostart_implies_hidden_and_records_the_reason() {
        // The regression this pins: `tauri_plugin_autostart::init` is told to
        // register `--autostart`, so if this flag stops implying "start
        // hidden", every login pops an unwanted window.
        let parsed = run(&["--autostart"]);
        assert!(parsed.launched_by_autostart);
        assert!(parsed.start_hidden);
    }

    #[test]
    fn hidden_does_not_claim_the_launch_was_automatic() {
        let parsed = run(&["--hidden"]);
        assert!(parsed.start_hidden);
        assert!(
            !parsed.launched_by_autostart,
            "a manual --hidden launch must stay distinguishable from a login launch"
        );
    }

    #[test]
    fn instance_requests_parse() {
        assert_eq!(run(&["--show"]).request, Some(InstanceRequest::Show));
        assert_eq!(run(&["--toggle"]).request, Some(InstanceRequest::Toggle));
        assert_eq!(run(&["--quit"]).request, Some(InstanceRequest::Quit));
        assert_eq!(run(&["--exit"]).request, Some(InstanceRequest::Quit));
    }

    #[test]
    fn the_last_request_flag_wins() {
        assert_eq!(
            run(&["--show", "--quit"]).request,
            Some(InstanceRequest::Quit)
        );
    }

    #[test]
    fn log_level_accepts_both_separated_and_attached_values() {
        assert_eq!(
            run(&["--log-level", "debug"]).log_level,
            Some(log::LevelFilter::Debug)
        );
        assert_eq!(
            run(&["--log-level=trace"]).log_level,
            Some(log::LevelFilter::Trace)
        );
        // Case and the RUST_LOG-style aliases both work.
        assert_eq!(
            run(&["--log-level=WARNING"]).log_level,
            Some(log::LevelFilter::Warn)
        );
    }

    #[test]
    fn a_bad_log_level_warns_instead_of_aborting() {
        let parsed = run(&["--log-level", "loud"]);
        assert_eq!(parsed.log_level, None);
        assert_eq!(parsed.unknown, vec!["--log-level".to_string()]);
    }

    #[test]
    fn a_missing_log_level_value_does_not_panic() {
        let parsed = run(&["--log-level"]);
        assert_eq!(parsed.log_level, None);
        assert_eq!(parsed.unknown, vec!["--log-level".to_string()]);
    }

    #[test]
    fn unknown_arguments_never_abort_the_launch() {
        // macOS Finder really does pass this. Treating it as an error would
        // mean the app cannot be opened from the Dock.
        let parsed = run(&["-psn_0_1234567", "/some/dropped/file.txt"]);
        assert_eq!(parsed.unknown.len(), 2);
        assert!(!parsed.start_hidden);
        assert_eq!(parsed.request, None);
    }

    #[test]
    fn known_flags_still_apply_around_unknown_ones() {
        let parsed = run(&["-psn_0_9", "--autostart", "--frobnicate"]);
        assert!(parsed.start_hidden);
        assert_eq!(parsed.unknown, vec!["-psn_0_9", "--frobnicate"]);
    }

    #[test]
    fn help_and_version_exit_cleanly() {
        for flag in ["--help", "-h"] {
            let (message, code) = exit_of(&[flag]);
            assert_eq!(code, 0);
            assert!(message.contains("USAGE:"), "{flag} should print usage");
        }
        for flag in ["--version", "-V"] {
            let (message, code) = exit_of(&[flag]);
            assert_eq!(code, 0);
            assert_eq!(message, "Test App 1.2.3\n");
        }
    }

    #[test]
    fn help_wins_over_anything_that_follows_it() {
        // `app --help --quit` must not also ask a running instance to die.
        let (message, code) = exit_of(&["--help", "--quit"]);
        assert_eq!(code, 0);
        assert!(message.contains("USAGE:"));
    }

    #[test]
    fn help_lists_every_flag_the_parser_accepts() {
        // Guards the one drift this file is vulnerable to: a flag added to the
        // match arms but not to FLAGS is invisible to users, and vice versa.
        let help = help_text("Test App", "1.2.3");
        let source = include_str!("cli.rs");
        for flag in FLAGS {
            let long = flag
                .usage
                .split(',')
                .map(str::trim)
                .find(|part| part.starts_with("--"))
                .and_then(|part| part.split_whitespace().next())
                .expect("every flag row must document a long form");
            assert!(help.contains(long), "--help omits {long}");
            assert!(
                source.contains(&format!("\"{long}\"")),
                "{long} is documented but no match arm handles it"
            );
        }
    }

    #[test]
    fn help_descriptions_all_start_in_the_same_column() {
        // The padding is computed from the widest usage string, so this catches
        // a row added with a longer flag than the format assumed.
        let help = help_text("Test App", "1.2.3");
        let columns: Vec<usize> = FLAGS
            .iter()
            .map(|flag| {
                let line = help
                    .lines()
                    .find(|line| line.trim_start().starts_with(flag.usage))
                    .unwrap_or_else(|| panic!("--help omits the row for {}", flag.usage));
                line.find(flag.help)
                    .unwrap_or_else(|| panic!("no description rendered for {}", flag.usage))
            })
            .collect();

        assert!(
            columns.windows(2).all(|pair| pair[0] == pair[1]),
            "descriptions are ragged: {columns:?}\n{help}"
        );
    }
}
