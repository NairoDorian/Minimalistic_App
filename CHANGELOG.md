# Changelog

All notable changes to the **Minimalistic App** project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> [!NOTE]
> **Release flow (exact order)**: `bun run before-commit --bump <major|minor|patch>` → add this version's entry at the top of this file → `bun run arch` → `bun run before-commit --check` + `bun run typecheck` → commit & push (`feat(vX.Y.Z): ...`). Bump levels: **patch** = fixes (`0.8.1 → 0.8.2`), **minor** = backward-compatible features (`0.8.1 → 0.9.0`), **major** = breaking changes (`0.8.1 → 1.0.0`). Full walkthrough: `README.md` / `AGENTS.md`.

## [0.26.0] - 2026-08-20

### Round 26 — Full Bun 1.4 Port: Prerelease Dependency Sweep

#### 📦 Dependencies

- **Upgrade**: All direct and transitive dependencies swept to their latest
  prerelease versions via `bun run update-deps --prerelease` (TypeScript
  7.1.0-dev, SolidJS 2 RC, oxlint, prettier, vite, etc.).
- **Upgrade**: Replaced `@types/bun@^1.3.14` with `bun-types@^1.4.0` for
  Bun 1.4 compatibility. `@types/bun` is a one-line DefinitelyTyped wrapper
  that just does `/// <reference types="bun-types" />`, so depending on
  `bun-types` directly gives the same type surface with the correct version.
  `tsconfig.json` `"types"` array updated from `"bun"` to `"bun-types"` to
  match.
- **Added**: `bunfig.toml` with `env = false` (top-level) to disable automatic
  `.env` file loading, and `linker = "isolated"` to enable Bun 1.4's global
  virtual store (up to 7x faster warm installs after `rm -rf node_modules`).
  Corrected Handy_V2's two `bunfig.toml` mistakes: the invalid
  `globalVirtualStore` key and the mis-placed `env = false` under `[env]`.

## [0.25.1] - 2026-08-20

### Chore — Bun 1.4 type definitions upgrade

#### 📦 Dependencies

- **Upgrade**: Replaced `@types/bun@^1.3.14` with `bun-types@^1.4.0` for
  Bun 1.4 compatibility. `@types/bun` is a one-line DefinitelyTyped wrapper
  that just does `/// <reference types="bun-types" />`, so depending on
  `bun-types` directly gives the same type surface with the correct version.
  `tsconfig.json` `"types"` array updated from `"bun"` to `"bun-types"` to
  match.
- **Upgrade**: Bun runtime is `v1.4.0-canary.1`. `bun install` regenerated
  the lockfile with `bun-types@1.4.0` replacing the old `@types/bun@1.3.14`;
  lockfile format remains v1 (the canary does not yet auto-migrate to
  `lockfileVersion: 2` — stable will migrate on next install).
- **Added**: `bunfig.toml` with `env = false` to disable automatic `.env`
  file loading — the Minimalistic App is a Tauri desktop app that manages its
  own environment variables via `tauri.conf.json` build scripts. This prevents
  stray `.env` files from injecting variables into the dev server / build.
  Set to use `linker = "isolated"` to enable Bun 1.4's global virtual store
  (up to 7x faster warm installs after `rm -rf node_modules`), replacing the
  default `"hoisted"` linker. See: <https://bun.com/docs/pm/global-store>.
  Note: Handy_V2's initial attempt used `globalVirtualStore` (invalid key)
  and `env = false` under `[env]` (wrong syntax); Bun 1.4's strict TOML
  parser rejects unknown keys, so the correction was `linker = "isolated"`
  at top-level `env = false`.

## [0.25.0] - 2026-08-20

### Round 25 — The Dead Flag, the Reload Key, and the Leaky Portable Mode

Third pass through [AIVORelay](https://github.com/MaxITService/AIVORelay), synced
to `v1.0.32` (`708a7f3`). Two of its modules turned out to describe **live
defects in this template** rather than missing features, which is the most useful
thing a reference implementation can do for you.

#### 🐞 Fixed: `--autostart` was registered and never read

- `tauri_plugin_autostart::init(…, Some(vec!["--autostart"]))` has been in
  `run()` since the autostart work in Round 24. It writes that argument into the
  OS launch entry — and **nothing in the app ever looked at it**. A launch at
  login was therefore indistinguishable from a double-click, so the window
  appeared in the user's face at every boot unless they had separately turned on
  `start_minimized`.
- **New `src-tauri/src/cli.rs`** parses the flags a desktop app actually
  receives, and `--autostart` now implies "start hidden". The two facts are kept
  distinct (`launched_by_autostart` vs. `start_hidden`), because "we were
  auto-started" is the fact and "do not show a window" is only one consequence of
  it — a later feature that wants to skip the update check on a login launch
  needs the fact.
- The flag ORs with the `start_minimized` preference rather than replacing it, so
  a user who wants a visible window on a manual launch still gets a quiet login.

#### 🐞 Fixed: a second launch could not talk to the first

- The single-instance callback took `|app, _args, _cwd|` and unconditionally
  showed the window. The plugin was handing us the blocked process's argv and we
  were throwing it away.
- Now the forwarded argv is re-parsed and acted on: **`--show`**, **`--toggle`**,
  **`--quit`**. That is what makes `app.exe --toggle` work from a desktop
  shortcut, a scheduled task, a stream-deck button, or a script — the standard
  way a tray application is driven from outside itself.
- A duplicate `--autostart` launch (fast user switch, session restore) is now
  ignored instead of raising the window, and anything unrecognized still falls
  back to "show me", which is why most second launches happen at all.
- `request_quit()` extracted so the tray menu and a forwarded `--quit` share one
  ordering: set `is_quitting` **first** (or `CloseRequested` just hides the
  window and leaves a headless process behind), detach the OS keyboard hook, then
  close.

#### 🐞 Fixed: portable mode was not portable on Windows

- `portable.rs` redirected everything **this app** writes. It had no effect on
  what the **webview engine** writes underneath it — WebView2 kept creating
  `%LOCALAPPDATA%\<identifier>\EBWebView\` for localStorage, IndexedDB, cookies
  and caches. Since this template's localStorage holds the active tab, theme and
  shortcut overrides, "run it from a USB stick, leave no trace" was false.
- **New `src-tauri/src/webview_runtime.rs`** points the engine's user-data folder
  into `<exe dir>/Data/EBWebView/` when the portable marker is present.
- The obvious route does not work and the module says why: `data_directory` in
  `tauri.conf.json` is resolved by Tauri **relative to the OS local-data
  directory** and absolute paths are rejected outright, so a declaratively
  configured window can never point outside the user profile. Only the
  `WEBVIEW2_USER_DATA_FOLDER` loader variable can, set before the first window
  exists.
- **Verified empirically, not assumed**: with the variable set the `EBWebView`
  folder appears at the requested path and the default location is left untouched.
- macOS and Linux are documented as **not** covered, with the reason (WKWebView
  offers a `dataStoreIdentifier` UUID rather than a path; WebKitGTK has no
  documented override). A template that implies a guarantee it cannot keep is
  worse than one that states the limit.

#### 🛡️ A shipped build no longer behaves like a web browser

Left at defaults, a release Tauri app answers `F5` and `Ctrl+R` by **reloading
the webview and destroying every bit of in-memory state**, `Ctrl+P` with a print
dialog for its own UI, `Ctrl+F` with the engine's find bar drawn over the app,
and `Ctrl+±` by zooming the layout apart. Users find these by accident, because
they are muscle memory from the browser next door.

- **`src-tauri/src/webview_hardening.rs` (new)** switches the accelerators off
  inside WebView2 (`AreBrowserAcceleratorKeysEnabled`). This is the real fix —
  the keystroke never becomes a browser command — but the switch exists only on
  Windows.
- **`src/lib/hardening.ts` (new)** does the same job with `preventDefault`, which
  is the only option on macOS (WKWebView) and Linux (WebKitGTK), and additionally
  covers what no engine flag addresses:
  - **a dropped file navigating the app away.** Drag any file onto a webview and
    it navigates to it: the entire UI is replaced by a PDF viewer with no back
    button, recoverable only by restarting. Both `dragover` and `drop` must be
    cancelled — cancelling only `drop` looks right and does nothing, because
    without a cancelled `dragover` the element was never a drop target.
  - the browser context menu (Reload / Back / View Source), with a
    `data-context-menu` opt-out for a future custom menu.
- **What is deliberately not blocked**: `Ctrl+C/V/X/Z/A` are OS text-editing
  shortcuts, not browser ones; and nothing at all is intercepted while focus is
  in a text field, where `Ctrl+F` means "find in this box".
- **Development builds are untouched.** The Rust half is `#[cfg]`-compiled out
  and the TypeScript half checks `import.meta.env.PROD`, so `F5` and devtools
  still work while you are building the frontend. A plain browser preview is also
  left alone — swallowing `F5` there would be baffling.

#### 🗂️ Versioned settings migration — `src-tauri/src/settings_migrate.rs` (new)

`settings_repair.rs` (Round 23) heals a document whose **types** are wrong. It is
structurally blind to the other failure mode, which is the more common one in a
long-lived app: _the document deserializes perfectly and means the wrong thing._

- **A worked first step, not a placeholder.** `global_hotkeys` has always been a
  map in disguise — at most one binding per action — and nothing enforced that on
  the way in from disk. The two consumers disagreed about what a duplicate means:
  `bindings_for_ui` uses `.find()` (**first wins**, and that is what Preferences
  shows), while `GlobalHotkeys::apply` registers **every** entry. So a settings
  file with two `toggle_window` entries gave the user two live system-wide
  chords while the UI showed one, and the second was invisible and unremovable.
  The v0 → v1 step enforces one binding per action and one action per chord.
- The asymmetry is instructive: `set_global_hotkey` already rejected a chord
  bound to another action, and `sanitizeGlobalHotkeys` in
  `src/lib/settingsBackup.ts` already dropped duplicate actions on import. Only
  the disk loader had no opinion — which is how this survives review, because
  each path looks correct on its own.
- **`settings_version` had to be added before it was needed.** A file written by
  a build with no version field is indistinguishable from one written at whatever
  version the field was introduced. Note the deliberate asymmetry:
  `#[serde(default)]` yields `0` ("predates versioning") while
  `AppSettings::default()` yields the current version ("fresh install, nothing to
  migrate"). Collapsing the two would make every legacy file look up to date.
- **Ordering is not negotiable**: `read → parse → migrate → repair → deserialize`.
  Migration runs on the raw `serde_json::Value`, because once repair has merged
  the document over current defaults a renamed key has already been replaced by
  its default and there is nothing left to migrate.
- A document from a **newer** build is detected and left completely alone —
  neither migrated nor stamped downward — so a user running two versions against
  one profile does not lose the newer version's data.
- An imported backup **carries its recorded version through** rather than being
  stamped current, so the ladder still runs on it at next launch. Stamping would
  make every future migration skip exactly the old documents that need it.

#### 🔍 Diagnostics and CLI ergonomics

- **`--log-level=<level>`**, then `RUST_LOG`, then `info`. Talking a user through
  one flag beats talking them through an environment variable, and `RUST_LOG` is
  the spelling every Rust developer already has muscle memory for.
- **`--help` and `--version` print on Windows.** They previously wrote into the
  void: `windows_subsystem = "windows"` means a release binary starts with no
  standard handles, so the command returned instantly with no output and the flag
  looked broken. `cli::print_and_exit` now attaches to the parent console
  (`AttachConsole(ATTACH_PARENT_PROCESS)`) before writing.
- **Unknown arguments are never fatal.** A CLI tool should reject
  `--frobnicate`; a GUI application must not, because desktop shells inject
  arguments it never asked for — macOS passes `-psn_0_1234567` when the app is
  opened from Finder. They are collected and logged once the logger exists.

#### 🐧 Conditional Linux graphics workaround

- `apply_linux_graphics_workarounds()` in `main.rs` sets
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` for the WebKitGTK blank-window /
  flicker / crash-on-resize bug (tauri-apps/tauri#9394) — but **only** on an X11
  session with a DRI device present, and never over a value the user or their
  distro already set.
- The blanket version found in most issue threads is what Tauri's own guide warns
  against: _"Only ship an unconditional override like this if you have verified
  your app is affected. It disables a faster path for everyone."_

#### 🐞 Fixed: a randomly aborting Rust test suite

- `panic_log.rs`'s test helper installed the **process-global** panic hook while
  `cargo test` was running tests on several threads. Two concurrent calls
  interleaved so that one uninstalled the other's hook mid-flight, and the
  resulting `.expect()` panicked _inside_ a panic hook. That is not a test
  failure — it is `STATUS_STACK_BUFFER_OVERRUN` and the **entire test binary
  aborts**, taking every unrelated result with it and blaming a line that had
  nothing to do with it.
- Surfaced by adding tests elsewhere, which is exactly how a load-dependent race
  behaves: it looks like the new tests' fault. Fixed with one process-wide lock
  and poison-recovering `lock()` calls. Stress-checked over repeated parallel
  runs.

#### 🧹 Smaller things

- **Backup rotation for quarantined settings.** `quarantine_unreadable_settings`
  used one fixed `settings.json.bak`. Corruption is rarely a single event — a
  failing disk, a sync client, a script writing bad JSON in a loop — and the
  second quarantine overwrote the backup taken from the first, which was the one
  still holding the user's real settings. Now takes the first free slot of five
  before reusing the oldest: never clobber while an alternative exists, never
  grow without bound.
- **`isTextEntryTarget` deduplicated** into `src/lib/keyboard.ts`, and rewritten
  from an `instanceof HTMLInputElement` chain to duck typing. `instanceof`
  compares against _this_ window's constructors, so an element from an
  `<iframe>` or another document silently fails the check while being a perfectly
  real text field — and the DOM constructors do not exist in a bare Bun test
  process, which is what forced the rule to be untestable before.
- `BINDINGS_PATH` gated to `#[cfg(debug_assertions)]`, matching its only use;
  it was a dead-code warning in a release build.

#### ✅ Verification

- `bun test` **156 pass / 0 fail** (10 files; new `test/hardening.test.ts`,
  extended `test/settings.test.ts`).
- `cargo test` **178 pass / 0 fail**, stable across repeated parallel runs.
- `cargo clippy --all-targets -- -D warnings` clean; `cargo check --release`
  clean (which is where a `webview2-com` / `windows-core` version skew against
  Tauri's own would have surfaced — both are pinned to what wry links and cost no
  extra compilation).
- `tsc -b` and `oxlint` clean; `bun run before-commit --check` in sync.

---

## [0.24.0] - 2026-08-20

### Round 24 — More From the Reference Implementation: Autostart Safety, Portable Mode, Crash Evidence, IPC Contract Test

Second pass through [AIVORelay](https://github.com/MaxITService/AIVORelay). One
of its guards turned out to describe a **real bug in this template**; the rest
are capabilities a starting point should ship.

#### 🐞 Fixed: a dev session could sabotage your installed app's autostart

- **`@tauri-apps/plugin-autostart`'s `enable()` registers the path of the
  _running_ executable.** The Preferences toggle called it directly from the
  frontend, so one click during `bun run tauri dev` replaced the installed
  application's OS launch entry with a path into `src-tauri/target/debug/`. The
  user finds out at the next reboot — either nothing starts, because the target
  directory was cleaned, or a stale debug build starts instead of the app they
  installed. Nothing about it is visible while it happens, and developing a
  desktop app means toggling its preferences.
- **New `src-tauri/src/autostart.rs`** takes ownership of the write:
  - the user's intent is stored in `AppSettings.autostart_enabled`, and the OS
    entry is **derived state** reconciled at startup — so an entry removed
    externally (reinstall, cleanup tool) comes back instead of the preference
    quietly becoming a lie;
  - a **development build never writes it** (`cfg!(debug_assertions)`), records
    the preference anyway so it survives into the release build, and reports
    `dev_build: true` to the UI, which shows a note under the toggle rather than
    implying something happened outside the app;
  - new `get_autostart` / `set_autostart` IPC commands, disk-first like every
    other preference writer here.
- **The webview now needs no autostart permission at all.**
  `autostart:allow-enable` / `allow-disable` / `allow-is-enabled` are gone from
  `capabilities/default.json` and `@tauri-apps/plugin-autostart` is gone from
  `package.json` — the capability surface and the hazard were removed together.
- Verified live: launching the debug build logs
  `[autostart] Development build: leaving the OS launch entry untouched`.

#### 🧳 Portable Mode — `src-tauri/src/portable.rs` (new)

- An empty file named `portable` beside the executable redirects settings and
  logs to `<exe dir>/Data/`. Runs from removable media, leaves no trace on the
  host — which matters for an app that can register itself at OS startup and
  install a global keyboard hook — and is the quickest way to get a clean
  profile for testing without disturbing your real one.
- Resolved **once** at process start, before the logging plugin is registered, so
  both `settings.json` and the rotating log file follow it. An unwritable
  location falls back to the OS directories with a message rather than failing to
  launch.
- New `get_portable_status` IPC command; the About tab gained a full-width
  **Data Location** tile showing the active directory and whether it is portable.
- Verified live: with a marker present, the app logged
  `[portable] Portable mode active`, wrote `Data/settings.json` and
  `Data/logs/Minimalistic App.log`, and created nothing in the OS directories.

#### 💥 Crashes Leave Evidence — `src-tauri/src/panic_log.rs` (new)

- Rust's default panic handler writes to **stderr**, which a bundled desktop app
  does not have: Windows builds with `windows_subsystem = "windows"` precisely so
  no console appears, and a macOS `.app` from Finder has nowhere for it to go. So
  the one message explaining a crash went to a stream nobody reads.
- Two things made that worse here: the release profile sets `panic = "abort"`, so
  there is no unwinding and no second chance; and the global hotkey engine runs an
  OS keyboard hook on a **background thread**, where a panic never reaches a
  user-facing error boundary.
- A hook now logs the panic — message, source location, and **thread name** —
  through the `log` facade before the process dies, so it reaches the rotating log
  file the bug-report template already asks users to attach, and the in-app Dev
  Console live. The default handler still runs afterwards, so terminal and
  `cargo test` behaviour is unchanged.

#### 🔗 IPC Contract Drift Is Now a Test — `test/bindings.test.ts` (new)

- `src/bindings.ts` is generated **at runtime** by the debug build, so adding a
  Rust command and committing without launching the app leaves the frontend
  calling a contract the backend no longer has. A comment in `lib.rs` claimed a
  freshness test existed; none did.
- The test compares the `collect_commands![…]` registry against the generated
  wrappers **as source text**. It caught real drift on its first run (the three
  commands added above).
- It has to be a source comparison, and the reason is worth recording: a Rust test
  that re-renders the bindings from `specta_builder()` links `tauri::Wry`, and the
  resulting test executable fails to start on Windows with
  `STATUS_ENTRYPOINT_NOT_FOUND` because the webview runtime is not beside it. That
  approach was implemented, diagnosed, and abandoned; the stale comment in
  `lib.rs` now says so.
- Honest limitation, stated in the test: it catches a command added, renamed or
  removed — not a changed _signature_.

#### 🧪 Tests

- **Rust 132 → 143**, **frontend 130 → 135**. New coverage for portable-mode
  resolution, dev-build detection, panic description (including from a named
  background thread), and the IPC contract.
- `Required<AppSettings>` made the compiler enumerate every place the new
  `autostart_enabled` field had to be handled, including the untrusted-backup
  sanitizer in `src/lib/settingsBackup.ts`.

#### 📖 Documentation

- `README.md` — four new capability sections.
- `SECURITY.md` — autostart's removal from the capability list explained; new
  §2 on portable mode, with its limits stated plainly (it is not encryption, and
  the OS autostart entry is inherently not portable); IPC table updated to
  nineteen commands.
- `AGENTS.md` — new rules: guard anything that depends on the running
  executable's path behind `cfg!(debug_assertions)`; resolve app-written paths
  through `portable::`; regenerate bindings when the command surface changes.
- `TESTING.md` — the five new test files in the layout table.

## [0.23.0] - 2026-08-20

### Round 23 — Practices Borrowed From a Production Tauri App: 2.6× Faster Dev Loop, Self-Healing Settings

Read the source of [AIVORelay](https://github.com/MaxITService/AIVORelay) — a
production Tauri 2 desktop app with a 100-plus-module Rust backend — and adopted
the practices that fit a starting-point template. Each was re-derived and
re-measured here rather than copied; the full adopted/rejected ledger with
reasoning is [`DOCUMENTATION.md`](DOCUMENTATION.md) §6.

#### ⚡ Fast Dev Loop — `bun run dev:fast` (new)

- **A one-line Rust edit now goes from 10.17 s to 3.92 s — 2.6× — back to a
  running binary.** Measured on this repository (Windows 11, warm target dir),
  not quoted: the slow half of a Tauri edit→relaunch loop is _linking_, and two
  settings dominate it — LLVM's `lld` (which links in parallel) and
  `CARGO_PROFILE_DEV_DEBUG=limited` (which keeps file/line info in backtraces
  while dropping the expensive rest).
- **New `scripts/dev-fast.ts`** detects the best available fast linker per
  platform — `lld-link` on Windows, `mold` then `ld.lld` on Linux, `ld64.lld` on
  macOS — and applies both settings as **environment variables for that one
  process**. Nothing is written to disk, so there is nothing to revert and
  nothing that can leak into a commit. With no fast linker installed it prints
  an install hint and runs an ordinary dev session, so it is always safe to use
  as the default dev command. `--check` reports the detected configuration
  without launching; `--debug <level>` overrides the debuginfo level.
- **New `.cargo/config.toml`** carries the measurement table, per-platform
  `linker`/`rustflags` snippets (**commented out** — an uncommented entry would
  break the build for every contributor and CI runner without LLVM, and a
  template must clone-and-build on a bare toolchain), and the tuning knobs that
  were tested and found **not** to help: forcing `CARGO_BUILD_JOBS` above the
  logical CPU count, explicit `codegen-units`, and `profile.dev.build-override`
  all lost to Cargo's defaults. It also enables
  `[future-incompat-report] frequency = "always"`.
- ⚠️ Documented caveat: changing the debuginfo level invalidates the dependency
  cache, so alternating `tauri dev` with `dev:fast` costs a full rebuild each
  way. `dev:fast --debug full` takes the linker win without that.

#### 🩹 Self-Healing Settings — `src-tauri/src/settings_repair.rs` (new)

- **A single wrong-typed field no longer costs the user every other setting.**
  `#[serde(default)]` covers a _missing_ field but does nothing for one that is
  present with the wrong type: one `"minimize_to_tray": "yes"` made
  `from_str::<AppSettings>` fail for the whole document, and the old response —
  quarantine the file, start from defaults — discarded the accent colour,
  hotkeys, window geometry and tray behaviour along with it.
- The loader now merges the stored JSON over the serialized defaults, uses
  **`serde_path_to_error`** to learn the exact JSON path serde rejected
  (`theme_accent`, `global_hotkeys[2].spec`), resets that field alone, and
  retries under a bounded attempt budget. Each repair is logged by path, and the
  healed document is written back so the next launch starts clean.
- Failure handling is now a graded ladder rather than one branch: missing file →
  silent defaults; **unreadable** file → defaults for this session but
  deliberately **no** quarantine (renaming would turn a transient permissions or
  I/O error into permanent data loss); not-valid-JSON → quarantine to `.bak`;
  valid JSON with bad fields → repair in place.
- **11 new Rust tests**: wrong types, several broken fields at once, missing
  keys, unknown keys preserved for downgrade-safety, a broken element nested in
  a collection, an out-of-range integer, a scalar where an object belongs, plus
  path-parsing and merge unit tests. Two end-to-end tests assert the file is
  repaired _and not quarantined_, and that a valid hotkey binding survives a
  malformed neighbour.

#### 📱 Mobile-Capable Library Target

- `src-tauri/Cargo.toml` gained a `[lib]` section with
  `crate-type = ["staticlib", "cdylib", "rlib"]`. `run()` already carried
  `#[cfg_attr(mobile, tauri::mobile_entry_point)]`, but without those crate types
  a mobile build could never have linked it — the template advertised a mobile
  entry point it could not build. The `_lib` name suffix additionally avoids the
  Windows lib/bin name collision (rust-lang/cargo#8519).

#### 📚 Reference-Implementation Mirror

- **`bun run docs:sync` now vendors a sixth source**: AIVORelay's Rust backend,
  `docs/`, and the maintainers' `.AGENTS/` engineering notes (sparse, ~6 MB).
  Reference manuals say what an API does; they do not say what an app built on
  it looks like after two years in production.
- `scripts/sync-docs.ts` gained a per-source `searchExtensions` field so
  `docs:find` searches `.rs` in that mirror and markdown everywhere else.
- **Two bugs found and fixed in the sync script** while adding it: a `*.md` glob
  in a sparse spec is rejected by git's _cone mode_ and made the whole
  `sparse-checkout set` call fail, leaving the clone checked out at root level;
  and because the update path never re-applied the sparse config, that
  half-configured clone then fetched, reset and **reported success forever**.
  The update path now re-asserts the sparse set every run, so a mirror heals
  itself instead of needing a manual delete.

#### 🗂️ Repository Templates

- `.github/ISSUE_TEMPLATE/bug_report.md` — points reporters at the app's own
  **Copy Diagnostics** button (System & About tab) and Dev Console, so the
  environment and log sections fill themselves in.
- `.github/ISSUE_TEMPLATE/feature_request.md` — asks for the _problem_, and for
  the case that an addition belongs in something deliberately minimal.
- `.github/ISSUE_TEMPLATE/config.yml` — routes stack questions to
  `DOCUMENTATION.md`, build problems to `BUILD.md`, and vulnerabilities to the
  private process in `SECURITY.md`.
- `.github/PULL_REQUEST_TEMPLATE.md` — requires a human-written "why" even when
  a tool wrote the code, a citation of the local doc mirror for framework-shaped
  changes, and an explicit statement of whether the change was manually run.

#### 📖 Documentation

- `DOCUMENTATION.md` §6 — the adopted/rejected ledger, including why the
  Windows-only CDP remote-debugging hook was **not** taken (Tauri's WebDriver
  path is the cross-platform answer and works with a config-declared window) and
  why i18n / zustand / zod / tailwind stay out of a template.
- `BUILD.md` — new setup step 5 with the measurement table and per-OS installs.
- `README.md` — fast-dev-loop and self-healing-settings feature sections.
- `SECURITY.md` — untrusted-file tolerance as a distinct hardening property.
- `AGENTS.md`, `CRUSH.md` — `dev:fast` in the command tables.

## [0.22.0] - 2026-08-20

### Round 22 — Documentation-Driven Audit: Async State in the Graph, Lifecycle Correctness, CSP Least Privilege

A full read of `src/` and `src-tauri/` against the local mirrors added in
v0.21.0 (`bun run docs:find`), fixing four real bugs and bringing the frontend
onto the SolidJS 2 patterns its own reference prescribes.

#### 🐞 Bugs Fixed

- **A toggle clicked while preferences were still loading was silently reverted.**
  `PreferencesTab` mounted with placeholder values (all `false`, `checkUpdates`
  `true`) and populated them from a `.then()` when the IPC settled. A click in
  that window was written to disk by the handler and then overwritten in the UI
  by the loader's `setX(settings.x)`, leaving screen and disk disagreeing until
  the next launch. The rows now sit inside a `<Loading>` boundary and simply do
  not exist until the read settles.
- **The tray's "Check for Updates" did nothing unless the Preferences tab was
  open.** The only instance listening for the `check-for-updates` event was the
  `UpdateChecker` card, which is unmounted whenever another tab is selected.
  Event listening moved to the footer instance, which is mounted for the whole
  session; the card keeps the launch auto-check. (`src/App.tsx`,
  `src/components/PreferencesTab.tsx`)
- **Turning on "check for updates on launch" fired an immediate update check.**
  `UpdateChecker` registered its setup in a re-running `createEffect` whose
  compute tracked `autoCheckOnMount`, so flipping the preference re-ran the whole
  block — a network check plus a teardown and re-registration of the tray
  listener. Now one-time owned setup via `onSettled`, reading both props once
  through `untrack`.
- **The reset-confirmation timer outlived its component.** `DeveloperTab`'s
  two-step "Reset All Settings" armed a 4 s `setTimeout` with no cleanup and no
  guard against stacking, so switching tabs left a timer writing to a disposed
  signal. Tracked and cleared on teardown, and restarted rather than stacked.

#### ⚛️ SolidJS 2 Patterns (cites `.docs/solid-docs`)

- **`PreferencesTab` async load moved into the reactive graph.** One
  `createMemo(async …)` replaces the mount-time `.then()`, an `isCancelled` flag
  and a `settingsLoaded` gate signal; the seven preference signals became
  writable derived signals (`createSignal(fn)`) over it — the documented shape
  for "starts from a reactive source but needs a local override"
  (`(5)guides/(0)avoid-unnecessary-effects.mdx`). The load-gate signal is now
  structural rather than explicit.
- **Memo computes are side-effect free.** `applyThemeAccent` (a DOM write) and
  the invalid-accent self-heal (an IPC write) moved out of the loader into
  `createEffect` apply phases. New pure `resolveThemeAccent()` in
  `src/lib/theme.ts` does the preset lookup with no DOM access, so it is safe to
  call from a compute.
- **`onCleanup` in a component body replaced by an `onSettled`-returned
  cleanup** in `HotkeyRecorder` — matching `App.tsx` from v0.21.0. Per
  `on-cleanup.mdx`, `onCleanup` is now a library/custom-primitive tool.
- **`GlobalHotkeysSection.statusLine` is a `createMemo` behind `<Show>`.** It
  was a plain function called four times per render, each call re-running the
  derivation and each needing a `!` assertion to re-narrow what the guard had
  already proven. `ACTION_ORDER` hoisted from an inline `Object.keys(...)` cast,
  mirroring `TAB_ORDER` in `App.tsx`.
- **`DevConsole` rows key on `LogLine.id`** (`keyed={(line) => line.id}`). The id
  existed and was documented as the row key but nothing used it — rows were
  keyed by object identity. With a key function the child receives an accessor,
  so a severity or message change updates the row in place.
- `setShowNotes(!showNotes())` → the updater form.

#### 🔒 Security

- **Dead CSP grants removed.** `connect-src` no longer lists
  `https://github.com` / `https://api.github.com`: no frontend code has ever
  fetched them, because the updater performs its HTTPS in the Rust process where
  the webview CSP does not apply. `SECURITY.md` now documents every directive
  and why it is there.
- **`localStorage` is guarded everywhere.** New `src/lib/storage.ts`
  (`readStored` / `writeStored` / `removeStored`) degrades a disabled, blocked or
  full store to "not persisted" instead of throwing into the render tree. Two of
  the four call sites were previously unguarded (`PreferencesTab`,
  `DeveloperTab`); `App.tsx` and `shortcuts.ts` had hand-rolled `try`/`catch`
  that now routes through the helper.

#### 🧪 Tests & Test Infrastructure

- **`bun test` was silently running against SolidJS's SSR build.** `solid-js`
  resolves to `dist/server.cjs` under Bun's default export conditions, and in
  that build effects never run and writes never propagate through the graph —
  any reactivity or component test would have exercised a runtime the app never
  ships, passing by doing nothing. The `test` script is now
  `bun test --conditions browser`, which selects `dist/solid.js`, the same
  client runtime Vite bundles into the webview. `bun run validate` and CI both
  go through the script, so both were fixed by the same change.
- `test/reactivity.test.ts` — 8 new contract tests pinning the SolidJS 2 shapes
  the components now depend on: that the runner really resolved the client build,
  that a writable derived signal accepts a local override, that the override is
  discarded when a dependency of the derivation changes but survives when the
  derivation never re-runs (the case `PreferencesTab` relies on), that an async
  memo reads as not-ready before it settles, and that an effect's apply-phase
  return value is called as a cleanup.
- **The effect-cleanup hazard this exposed:** Solid calls whatever an apply
  phase returns as its cleanup, so a concise arrow that happens to return a
  value — `(accent) => applyThemeAccent(accent)` returns a string — halts the
  reactive system on the effect's next run. All eight effects in `src/` were
  audited and already use block bodies; the rule is now documented in
  `CRUSH.md` pattern 4 and `AGENTS.md`.
- `test/storage.test.ts` — 9 new tests covering the working store, a store that
  throws on every operation, and a missing `localStorage` global.
- `test/theme.test.ts` — `resolveThemeAccent` coverage, including a test that
  runs it with no `document` global to prove it is DOM-free.
- Suite: **110 → 130** frontend tests, 119 Rust tests.

#### 🎨 UI

- `.settings-skeleton` placeholder rows for the Preferences `<Loading>`
  fallback, sized to the real `.setting-item` rhythm so the card does not jump.
  The shimmer is a single compositor-driven background animation and is
  neutralized by the existing `prefers-reduced-motion` rule.

#### 📚 Documentation

- `CRUSH.md` — new pattern 2 ("Async Data → Writable Derived Signal → Loading
  Boundary"); the UpdateChecker dual-variant rule rewritten to explain why the
  two jobs live on different instances.
- `AGENTS.md`, `CONTRIBUTING.md` — async-state, side-effect, storage and
  effect-cleanup rules.
- `TESTING.md` — a warning that a bare `bun test` gets the SSR build, plus the
  three new test files in the layout table.
- `README.md` — CSP description corrected, plus a note on the one remaining
  remote origin: Inter is loaded from the Google Fonts CDN, so the app falls
  back to a system sans-serif offline. Self-hosting it would drop two origins
  from the CSP; left as a product call.

## [0.21.0] - 2026-08-19

### Round 21 — Local Documentation Mirrors for the Whole Stack, SolidJS 2 Boundary Correctness & TypeScript 7 Audit

#### 📚 Documentation Infrastructure (new capability)

- **The upstream documentation for every layer of the stack is now vendored on disk** under `.docs/` (gitignored, ~200 MB) so architecture questions are answered from the primary source at the exact version this app runs — not from memory or a web search.
  | Layer | Mirror | Pinned branch |
  | :--- | :--- | :--- |
  | Tauri 2 | `tauri-apps/tauri-docs` | `v2` |
  | SolidJS 2 | `solidjs/solid-docs` | `v2-rebuild` |
  | Bun | `RiskyMH/bun-docs` | `main` |
  | TypeScript | `microsoft/TypeScript-Website` | `v2` (sparse) |
  | TypeScript 7 | `microsoft/typescript-go` | `main` (sparse) |
- **New `scripts/sync-docs.ts`** — the committed manifest is the source of truth, not the checkout: shallow (`--depth 1 --single-branch`) clones, partial (`--filter=blob:none --sparse`) for the two large Microsoft repos, fetch + hard-reset updates, and a status table reporting branch, commit, date, markdown count and size per mirror.
- **New scripts**: `bun run docs:sync` (clone/fast-forward), `bun run docs:check` (status, no network), `bun run docs:find "<query>"` (search all five mirrors at once, skipping `.git` and translation directories so one query does not return the same page in five languages). `--only <id>` restricts any of them to one source.
- **New `DOCUMENTATION.md`** — the master reading map: why the mirrors are gitignored, why each branch pin is load-bearing, a per-layer "I need to know X, read Y" table for Tauri 2 / SolidJS 2 / Bun / TypeScript, the layers that need no mirror (Rust via `rustup doc` and `cargo doc`, Vite, oxlint, Prettier), and the working agreement for doc-driven changes.
- **New `TYPESCRIPT-7.md`** — TypeScript 7 changed defaults, removed options (now hard errors), Unicode template-literal-type behaviour, the trimmed JS/JSDoc surface, new `--checkers`/`--builders`/`--singleThreaded` flags, the 7.1 programmatic-API caveat (and why oxlint makes it a non-issue here), plus a **compliance audit of both `tsconfig` projects — result: no changes required, this repo is TS7-clean**.
- `.docs/` and `.playwright-mcp/` added to `.gitignore`; `.docs/` added to `.prettierignore` so third-party docs are never reformatted.
- Documentation-first standard propagated into `README.md`, `AGENTS.md` (new critical section + best-practice rule + Common Tasks rows), `CONTRIBUTING.md` (new rule + PR checklist item), `CRUSH.md`, `BUILD.md` (new setup step 3), `TESTING.md`, and `SECURITY.md` (a claim → upstream-reference table).

#### ⚛️ SolidJS 2 Correctness (doc-driven, cites `.docs/solid-docs`)

- **`<Loading>` boundary re-scoped from the whole app to the single data-dependent slot** in `src/App.tsx`. Per `(2)concepts/(4)boundaries.mdx` — _"place a loading boundary around the smallest coherent region that its fallback should replace; keep navigation, forms, and other controls outside when they must remain available during the load"_ — the boundary now wraps only the About panel, the sole consumer of the `appInfo` async memo. The header, tab bar and footer stay mounted and interactive during the startup IPC round-trip, and a future revalidation can no longer blank the entire window.
- **`AppSkeleton` deleted** (~50 lines that duplicated the entire app shell) and replaced by a small `AboutTabSkeleton` card with `aria-busy="true"`. The chrome is rendered once, not twice.
- **Component-body `onCleanup` replaced by an `onSettled`-returned cleanup.** Per `(3)lifecycle-actions/on-settled.mdx` and `(6)advanced/(2)specialized-reactivity/on-cleanup.mdx`, `onSettled` returning a cleanup is the 2.0 component setup/teardown shape and `onCleanup` is now reserved for library/custom-primitive internals. Listener registration and the status-timer teardown now live in one block.
- **`<Errored>` now surfaces its `reset` function.** The fallback signature is `(err, reset)`; the crash screen gained a primary **"Try Again"** action that re-runs the reactive sources the boundary collected — recovering from a transient failure in place, without a full webview reload that would discard in-memory state such as the Dev Console feed. "Reload Application" is retained as the secondary escape hatch.
- `Loading` and `Errored` imported from `solid-js` (their canonical home) rather than the `@solidjs/web` re-export.

#### 🔒 Security (doc-driven, cites `.docs/tauri-docs`)

- **`autostart:default` removed from `src-tauri/capabilities/default.json`** in favour of the three explicit commands it expands to (`allow-enable`, `allow-disable`, `allow-is-enabled` — verified against the plugin's own `permissions/default.toml`). Behaviour is identical today, but pinning the individual commands means a future upstream widening of that permission set cannot silently broaden this app's surface. This is the form `plugin/autostart.mdx` itself documents. The capability `description` now records the reasoning.

#### 🧹 Hygiene

- Pre-existing Prettier indentation drift in `src/components/AboutTab.tsx` corrected.
- `scripts/generate-arch.ts` description map extended with `DOCUMENTATION.md`, `TYPESCRIPT-7.md` and `scripts/sync-docs.ts`; `ARCHITECTURE.md` regenerated.

## [0.20.1] - 2026-08-19

### SolidJS 2 Async-Graph Migration & Pipeline Hygiene

#### ⚛️ SolidJS 2 Async Data Loading (modernization)

- **App-level app-info loading migrated from legacy `onSettled` + Promise signal pattern to SolidJS 2's native `createMemo(async)` "async lives in the graph" model** in `src/App.tsx:92` — consumers read `appInfo()` as a plain accessor; `isPending(appInfo)` surfaces the in-flight state.
- **Root `<Loading fallback={<AppSkeleton />}>` boundary** added in `src/App.tsx:284` wrapping `<AppContent>`, absorbing the startup IPC round-trip (with 3-attempt exponential-backoff retries). In the browser preview the memo resolves synchronously so the skeleton never appears.
- **`AboutTab` prop type tightened** from `() => AppInfo | null` to `() => AppInfo` at `src/components/AboutTab.tsx:15` — the `<Loading>` boundary guarantees readiness, eliminating all null-check fallbacks in tile JSX and diagnostic handlers.
- **Tile JSX subscribes directly** to `props.appInfo()` in tracking scope; event handlers (`buildDiagnosticsText`, `handleSaveReport`) switched to `untrack(() => props.appInfo())` for safe non-tracking reads.
- `AppSkeleton` tray-status badge now respects `isTauri` instead of hardcoding `web-preview`.

#### 📦 Dependency Hygiene

- `@solidjs/web` version pin normalized from `^2.0.0-rc.0` to `2.0.0-rc.0` in `package.json` to match the `solid-js` pin (eliminates resolution variance).

## [0.20.0] - 2026-08-19

### Round 20 — Cross-Platform Keyboard Engine, System-Wide Global Hotkeys, Correctness Pass & Pipeline Hygiene

#### 🌐 System-Wide Global Hotkeys (new — vendored, zero hotkey dependencies)

- **`src-tauri/src/hotkeys/` — a complete cross-platform global-hotkey engine embedded in the app**, derived from the MIT-licensed [`handy-keys`](https://github.com/handy-computer/handy-keys) crate and merged into the tree rather than depended on:
  - **Windows**: `WH_KEYBOARD_LL` / `WH_MOUSE_LL` low-level hooks on a dedicated message-loop thread, with automatic hook reinstall after a session change.
  - **macOS**: `CGEventTap` on its own `CFRunLoop`, with tap re-enable on timeout and an Accessibility permission check that can open the exact System Settings pane.
  - **Linux**: direct evdev `/dev/input/event*` reads (identical on Wayland, X11, and the console), device hotplug via inotify, and uinput re-injection for hotkey blocking.
  - Side-aware modifiers, modifier-only hotkeys, hotkey blocking, and a `KeyboardListener` for recording flows.
- **Merged, not copied.** The `bitflags` and `thiserror` dependencies were removed by hand-writing `Modifiers` (a nine-flag bitset with `bitflags`-compatible `!` semantics) and the `Error` enum (with user-facing `Display` messages that reach the UI verbatim). The code was migrated to Rust 2024 — explicit `unsafe` blocks inside `unsafe fn`, let-chains for every collapsible `if`, edition-2024 binding modes — and a platform-resolving `Mod` / `CmdOrCtrl` alias was added so one persisted spec works on every OS. **The only remaining dependencies are the OS bindings themselves** (`windows`, `objc2*`, `evdev`).
- **`src-tauri/src/global_hotkeys.rs`**: the app-level layer — action set, persisted bindings, a supervisor that rebuilds the OS listener on any change (joining the dispatch thread so the hook is released before a new one installs), and the status the UI displays.
- **Preferences → Global Hotkeys**: opt-in enable toggle, a recorder per action, live listener status (including the detect-only fallback when blocking is unavailable), cross-action conflict rejection, and a macOS Accessibility prompt.
- **Six new IPC commands** (`get_global_hotkeys`, `get_global_hotkey_status`, `validate_hotkey_spec`, `set_global_hotkey`, `set_global_hotkeys_enabled`, `open_accessibility_settings`) and a `global-hotkey` event so the UI can acknowledge a fired binding.
- **Privacy properties are documented and enforced** (see `SECURITY.md`): off by default, no listener without bindings, keystrokes never stored/logged/transmitted, no raw key stream over IPC, and deterministic hook release.
- **Verified end-to-end on Windows**: the listener starts with blocking enabled, and synthesized `Ctrl+Alt+U` / `Ctrl+Alt+Space` chords fire their actions from outside the app.

#### ⌨️ Cross-Platform Keyboard & Rebindable Shortcuts (new)

- **`src/lib/keyboard.ts` — self-contained hotkey engine** (zero dependencies), modeled on the [`handy-keys`](https://github.com/handy-computer/handy-keys) Rust crate and adapted to the webview's `KeyboardEvent` model:
  - Portable spec strings (`"Mod+Shift+K"` → ⌘⇧K on macOS, Ctrl+Shift+K elsewhere), compatible with Tauri's `CmdOrCtrl+…` accelerator syntax so one string can drive both.
  - Layout-independent matching on `KeyboardEvent.code` (physical position), with quoted tokens (`"Shift+'?'"`) opting into character matching for label-following bindings.
  - Side-aware modifier flags (`LCtrl`, `CtrlRight`, `AltGr`) with "either side" compound aliases, and a generous modifier/key alias table.
  - Strict per-group modifier semantics — a modifier the hotkey doesn't name must not be held, so `Ctrl+Alt+K` never fires a `Ctrl+K` binding.
  - Modifier-only hotkeys (`"Cmd+Shift"`), canonical round-tripping (`hotkeyToString` ⇄ `parseHotkey`), and platform-correct rendering (`⌃⌥⇧⌘` vs `Ctrl+Alt+Shift+Win`).
  - `createKeyboardListener()` — side-aware modifier tracking that reconciles against the event's boolean flags (self-healing after an alt-tab) and clears on blur.
  - `beginHotkeyCapture()` / `isCapturingHotkey()` — a shared capture guard so an armed recorder owns the keyboard and the chord being bound isn't also executed.
- **`src/lib/shortcuts.ts` rewritten as a rebindable registry**: stable per-binding ids, portable default specs, per-machine user overrides in `localStorage` (invalid or stale entries are ignored rather than disabling a binding), conflict detection, "rebinding to the default is a reset" semantics, and a subscribe bus.
- **`src/components/HotkeyRecorder.tsx` (new)**: "press a shortcut" capture control with a live preview of the held chord, Escape to cancel, and blur to cancel.
- **Shortcuts modal is now a rebinding surface**: every row is a live recorder, with per-row reset, conflict warnings, and a "Reset All Shortcuts" action. The cheat sheet and the runtime handler read the same registry, so they cannot drift.
- **Platform-correct labels everywhere**: shortcut labels were previously hardcoded as `"Ctrl+1 / Cmd+1"` on every OS; they now render per-platform from the live binding.
- **App shortcut dispatch** now resolves through the registry instead of a hardcoded `if/else` chain, and no longer uses the deprecated `navigator.platform` for Mac detection.

#### ⚛️ SolidJS 2 / TypeScript Frontend (`src`)

- **Fixed: About tab froze on its mount-time value.** `AboutTab` snapshotted `props.appInfo()` into a `const` in the component body; in SolidJS that runs once, so when About was the persisted startup tab, every tile showed `unknown` forever. Now read reactively in JSX.
- **Fixed: update check ran even when disabled.** `checkUpdatesOnLaunch` sits at its optimistic `true` default during the settings IPC round-trip, so the launch check fired before the persisted `false` arrived. `PreferencesTab` now gates the auto-check behind a `settingsLoaded` signal.
- **Fixed: unbounded id set in the Dev Console.** The bus-dedup `Set` grew for the life of the session; it is now pruned against the bus's own capped snapshot.
- **Fixed: blob downloads could be cancelled before starting.** `URL.revokeObjectURL` ran in the same tick as `link.click()`; extracted to `src/lib/download.ts`, which attaches the anchor, clicks, and revokes on the next macrotask. Used by both the settings backup and the diagnostic report.
- **Fixed: settings sanitizer could emit `undefined` typed as `number`.** `sanitizeSettings` now resolves the caller's fallback against factory defaults first, rejects arrays, and requires whole-number geometry (a fractional value would be rejected by serde at the IPC boundary).
- **Toast progress bar is now a CSS animation** bound to each toast's lifetime, replacing a 20 Hz `setInterval` that re-rendered the DOM for every visible toast.
- **`src/lib/appMeta.ts` (new)**: `APP_NAME` / `APP_SLUG` / `storageKey()` — the single place the frontend names the product. Removes hardcoded product names, download-filename prefixes, and the bundle identifier from components, and namespaces every localStorage key.
- **Dev Console empty state**: restored the previously-dead `.dev-console-empty` styling with a real, context-aware empty state.
- **`main.tsx`**: replaced the unused `export default dispose` and unchecked `as HTMLElement` cast with an explicit mount-target check and an `import.meta.hot.dispose` teardown so HMR can't stack app instances.
- **Resilience**: `localStorage` access for the persisted tab is now guarded, so disabled/full storage degrades instead of crashing into the error boundary.
- **De-duplication**: `TAB_ORDER` derives from `TABS`, shortcut categories derive from `APP_SHORTCUTS`, and the reset handler uses `DEFAULT_THEME_ACCENT` instead of a literal `'cyan'`.

#### 🦀 Rust Backend (`src-tauri`)

- **Fixed: potential startup panic.** `save_window_geometry` and the `CloseRequested` handler called `window.state::<AppState>()`, which panics if a `Moved`/`Resized` event arrives before `setup()` has managed the state — Tauri creates configured windows first. Both now use `try_state` and no-op safely.
- **Fixed: lost writes under concurrent settings updates.** `set_minimize_to_tray` took the settings lock three separate times around a read-modify-write, letting a concurrent writer's change be silently discarded. All settings commands now hold one guard across the whole operation, and commit to disk before mutating memory so the two can never disagree.
- **Fixed: corrupt settings were silently destroyed.** An unparseable `settings.json` fell back to defaults and was overwritten by the next save. It is now preserved as `settings.json.bak`, and `minimize_to_tray` gained `#[serde(default)]` so _every_ field tolerates absence — a file from an older or newer build loads instead of resetting everything.
- **Fixed: window flash on launch.** The main window is now declared `"visible": false` and shown explicitly from `setup()` after geometry restore, so `start_minimized` never flashes a window and a restored size/position never visibly jumps.
- **Performance: no monitor enumeration during window drags.** Position saving now runs only the cheap Windows-minimized sentinel check per event; the "is this position still on an attached monitor" check runs at restore time, which is when a display can actually have gone away.
- **`open_app_data_dir`** creates the config directory if it doesn't exist yet, so the file manager opens the real location instead of falling back to Documents.
- **Geometry flush-on-close**: move/resize events update only the in-memory cache; `flush_window_geometry` persists once on `CloseRequested`, eliminating the per-drag-tick rewrite of `settings.json`.
- **`specta_builder()` extracted** from `run()`, making the IPC command registry a single named definition.
- **Rust tests**: 6 → 10, adding partial/empty-JSON tolerance, corrupt-file quarantine, missing-file handling, and window-position guards.

#### 🔧 Project Tooling & Pipeline

- **8-gate validation suite**: `before-commit --full` now runs version sync → typecheck → lint → **bun test** → vite build → cargo check → **cargo test** → arch refresh, ordered cheapest-first. Step numbers are derived from the array, and gates call package scripts (`bun run lint`) rather than duplicating their command lines.
- **Script simplification**: `"test"` means `bun test` (it previously also ran the whole `--full` suite); `test:unit` removed; CI and the git hook updated to match.
- **`rename-project.ts` overhaul**: now rewrites `src/lib/appMeta.ts`, the `kill` script's process name, and `main.rs`'s crate path; uses kebab-case for the Cargo package name and snake_case only for the derived library path; and **warns loudly when a pattern matches nothing** instead of reporting success. Verified end-to-end on a scratch copy.
- **`generate-arch.ts`**: product name now derives from `tauri.conf.json` (so the doc follows a rebrand), added descriptions for every new file, and corrected several inaccurate ones (the log-viewer entries claimed ANSI stripping that does not exist).
- **Dead dependency removal**: removed unused `lucide-solid` (the icon set lives in `src/lib/icons.tsx`).
- **Dead CSS removal**: removed the legacy `ipc-output-box` block.
- **Release profile**: added `[profile.release]` (`opt-level = "z"`, `lto`, `codegen-units = 1`, `strip`, `panic = "abort"`) for smaller production binaries.
- **Typecheck coverage**: `test/` and `vite.config.ts` are now covered by `tsc -b` (added `@types/bun`); fixed a latent `exactOptionalPropertyTypes` violation in `vite.config.ts`.
- **`cargo clippy -D warnings` is now a gate** in both `before-commit --full` and CI, and the whole tree (including the vendored hotkey engine) is clippy-clean.
- **Tests**: 37 → 110 frontend tests (new `test/keyboard.test.ts`, rewritten `test/shortcuts.test.ts`, global-hotkey sanitizer cases) and 6 → 117 Rust tests (the vendored engine's own suite plus new settings/window-geometry coverage).
- **Documentation sync**: `README.md` (new keyboard section, corrected project tree, `rename-project`-first rebranding guide, `tauri-plugin-log`/`notification` added to the plugin table), `TESTING.md` (8 gates, unit-test layout, expanded manual QA matrix), `SECURITY.md` (accurate capability list, full 10-command IPC table, trust-boundary notes), `CRUSH.md` (corrected design tokens, real ARIA switch markup, new Rust locking and keyboard patterns), `CONTRIBUTING.md`, and `THIRD_PARTY_LICENSES.md` (handy-keys design attribution).

## [0.19.0] - 2026-08-18

### Round 19 — SolidJS 2.0 Migration

#### ⚛️ SolidJS 2 / TypeScript Frontend (`src`)

- **Framework migration**: Completed React 19 → SolidJS 2.0 (RC). Removed `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `vite-plugin-solid`, `lucide-react`; added `solid-js@2.0.0-rc.0`, `@solidjs/web`, `@solidjs/vite-plugin`, `lucide-solid`.
- **Full component rewrites**: `UpdateChecker.tsx` and `DeveloperTab.tsx` migrated from React hooks (`useState`/`useEffect`/`useRef`/`useCallback`/`FC`) to SolidJS 2 primitives (`createSignal` / `createEffect` split-phase compute/apply / `onSettled` / `Component`). `className`→`class`, `lucide-react`→`../lib/icons`.
- **Runtime crash fix**: `App.tsx` — SolidJS 2 `createEffect` requires both compute and apply functions. Converted single-argument `createEffect(() => { ... })` to `createEffect(() => activeTab(), (tab) => { ... })`.
- **DevConsole scroll fix**: Replaced `consoleEnd.scrollIntoView()` with `consoleContainer.scrollTop = scrollHeight` so only the terminal container scrolls, not the entire tab. Removed unused `consoleEnd` ref and anchor `<div>`.
- **Effect cleanup pattern**: Converted `onCleanup` calls inside `createEffect` apply functions to returned cleanup closures (`KeyboardShortcutsModal.tsx`, `Toast.tsx`). `createEffect(fn, depsArray)` → `onSettled` for one-shot side effects. `if (!cond) return null` → reactive `&&` JSX.
- **Type imports**: `JSX` is owned by `@solidjs/web` in SolidJS 2, not `solid-js`. Added `import type { JSX } from '@solidjs/web'` to `ErrorBoundary.tsx` and `ToggleSwitch.tsx`.
- **DOM attributes**: `tabIndex`→`tabindex`; ARIA booleans (`aria-selected`/`aria-checked`/`aria-disabled`/`aria-pressed`) → string `'true'`/`'false'`.
- **SVG attributes**: `src/lib/icons.tsx` — camelCase→kebab-case (`strokeWidth`→`stroke-width` etc.)

#### 🦀 Rust Backend (`src-tauri`)

- **Plugin alignment**: Upgraded `tauri-plugin-log` from `^0.4.33` (Tauri 1.x) to `^2.9.0`; added `log` crate.

#### 📦 Dependencies

- **Pre-release upgrade**: All deps to latest prerelease via `bun run update-deps --prerelease` — `prettier` → 4.0.0-alpha.13, `typescript` → 7.1.0-dev.20260818.1, `oxlint` → 1.79.0; removed React deps, added SolidJS 2 deps.

#### 🎨 Developer Experience

- Updated `generate-arch.ts` descriptions (React→SolidJS), Cargo.toml description, `version.ts` docstring.
- Added `.commandcode/` to `.prettierignore`.

## [0.18.0] - 2026-08-17

### Round 18 — Tauri Specta Type-Safe IPC Migration

#### ⚛️ React 19 / TypeScript Frontend (`src`)

- **Type-safe IPC**: Replaced all hand-written `invoke(command, args)` calls and hand-maintained DTO interfaces (`AppSettingsDto`, `AppInfo`) with auto-generated, type-safe `commands.*` wrappers from `src/bindings.ts`, produced by `tauri-specta` `Builder::export`. Eliminated the `AppSettingsDto` type alias; the frontend now imports `AppSettings` / `AppInfo` directly from the generated bindings.
- **Error handling mode**: Configured `tauri_specta::Builder` with `ErrorHandlingMode::Throw` so `Result<T, E>` commands throw on error (matching the existing try/catch pattern) and return `T` on success — no `typedResult` wrapper in the generated bindings.
- **Settings optionality**: Added `??` fallbacks at field-access sites in `sanitizeSettings` and `PreferencesTab` load path where the generated `AppSettings` has `#[serde(default)]` optional fields, satisfying `exactOptionalPropertyTypes` while preserving runtime correctness.

#### 🦀 Rust Backend (`src-tauri`)

- **`specta::Type` + `#[specta::specta]`**: Annotated all 10 IPC commands with `#[specta::specta]` and added `#[derive(specta::Type)]` to `AppSettings`, `AppInfo`, and `SystemStats` structs so `tauri-specta`'s `Builder::<tauri::Wry>::new().commands(collect_commands![...])` can collect and export them.
- **Owned string fields**: Changed `AppInfo` and `SystemStats` from `&'static str` to `String` for `os`, `arch`, and `tauri_version` to match `specta::Type` conventions for owned serialization.
- **Builder integration**: In `run()`, replaced `tauri::Builder::invoke_handler(generate_handler![...])` with `tauri_specta::Builder::<tauri::Wry>::new().commands(collect_commands![...])` + `builder.mount_events(app)` + `builder.invoke_handler()`, with `Builder::export(Typescript::default(), "../src/bindings.ts")` gated on `#[cfg(debug_assertions)]`.
- **New dependencies**: Added `specta = "=2.0.0-rc.25"`, `specta-typescript = "0.0.12"`, `tauri-specta = "=2.0.0-rc.25"` (features `["typescript"]`), and enabled the `"specta"` Cargo feature on `tauri`.

#### 🎨 Developer Experience

- **Generated bindings**: `src/bindings.ts` (auto-generated, added to `.prettierignore` + oxlint `ignorePatterns`).
- **DeveloperTab IPC playground**: Replaced dynamic `invoke(selectedCommand)` (string-based, untyped) with a type-safe `IPC_COMMAND_DISPATCH` record mapping command IDs to `commands.*` wrappers; moved to module scope to satisfy `react-hooks/exhaustive-deps`.

#### 🛠️ CI / Release

- **No version bump** — this is a feature addition (`0.17.0 → 0.18.0`).

## [0.17.0] - 2026-08-17

### Round 17 — Hardening & AIVORelay Reference Patterns

#### ⚛️ React 19 / TypeScript Frontend (`src`)

- **Window geometry persistence**: New `remember window size` / `remember window position` toggles in Preferences. The frontend preserves backend-managed `saved_window_*` fields across partial saves (via a settings snapshot) so toggling a preference never resets window geometry; corrupt geometry falls back through the settings sanitizer.
- **Settings self-heal**: When the persisted `theme_accent` isn't a known preset, the corrected fallback is written back to disk on load so a corrupted value never lingers.
- **Stricter CSP**: Appended `object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; frame-src 'none'` (directives borrowed from the AIVORelay reference app) onto the existing `script-src 'self'` policy — locks down the plugin/embed/framing/base-form attack surface without touching the dev HMR flow.
- **Debug Console testability**: Extracted the pure reconciliation helpers (`severityFromText`, `mergeFileLines`, `LogLine`/`LineSeverity`, `MAX_LINES`) out of `DevConsole.tsx` into a testable `src/lib/logViewer.ts` with zero behavior change.

#### 🦀 Rust Backend (`src-tauri`)

- **Window geometry persistence**: New `remember_window_size`, `remember_window_position`, `saved_window_{width,height,x,y}` fields on `AppSettings` (`i32::MIN` sentinel for unset position). Geometry is restored on startup (`set_size`/`set_position`) and persisted on `Resized`/`Moved` via `save_window_geometry` (dirty-checked, gated by the remember flags). Position safety mirrors AIVORelay (`is_windows_minimized_position` rejects Windows hottracked `(-32000,-32000)`; `saved_window_position_is_usable` rejects off-monitor coords).
- **Log filename derivation**: `tauri-plugin-log` now derives the log file from `app.package_info().name` (`file_name: None`), and `get_recent_logs`/`clear_logs` mirror that via a shared `log_file_path` helper — the Dev Console stays valid after `rename-project` rebrands the app.

#### 🎨 Developer Experience

- **VS Code launch config (`.vscode/launch.json`)**: "Debug Tauri (Full)" via the recommended Tauri extension plus a "Web Preview" Chromium config for the Vite dev server, so the Dev Console and window lifecycle are debuggable.

#### 🛠️ CI / Release

- **Aligned `release.yml` runners** with `ci.yml`: `ubuntu-22.04`→`ubuntu-24.04`, `macos-13`→`macos-14` (native x86_64 Intel kept for the `x86_64-apple-darwin` bundle — `macos-latest` is ARM and can't build native Intel).

#### 🎯 Testing (`test`)

- **DevConsole reconciliation tests** (`test/logViewer.test.ts`): 11 cases for `severityFromText` + `mergeFileLines` (append, count-aware dedup, live/file supersession, severity mismatch, `MAX_LINES` clamp).
- **Settings sanitizer** (`test/settings.test.ts`): expanded the `valid` fixture for the geometry schema + a case for corrupted window-geometry values falling back — 8 sanitizer cases.
- **Rust settings/window tests** (`src-tauri/src/lib.rs`): `AppSettings::default` + round-trip + atomic persistence now cover the geometry fields; added `test_is_windows_minimized_position`.

## [0.16.0] - 2026-08-16

### Round 16 — S2B2S Debug Console Port

#### 🦀 Rust Backend (`src-tauri`)

- **Log plugin (`tauri-plugin-log`)**: Registered with three targets — stdout, the app log directory (`<product-name>.log`, 500 KB Keep-One rotation), and the webview — so every backend diagnostic streams to the Dev Console as `log://log` events in real time. Added `log` facade dependency and lifecycle `log::info!`/`log::error!` instrumentation (state init, tray menu actions, settings parse/read failures) so the console shows genuine backend activity.
- **`get_recent_logs` / `clear_logs` IPC commands**: New commands mirroring S2B2S — read the last N lines of the backend log file (pure `tail_lines` helper, unit-tested) and truncate it — registered in the invoke handler.

#### ⚛️ React 19 / TypeScript Frontend (`src`)

- **Debug Console rewrite (`DevConsole.tsx`, S2B2S `LogViewer` port)**: The Activity Console is now a full log viewer fed by three sources — the frontend dev log bus, live `log://log` events from the Rust backend, and 2s auto-refresh polling of `get_recent_logs` (count-aware merge supersedes live lines with their on-disk counterparts, 2000-line hard cap). Adds severity filter (All/Error/Warn/Info/Debug/Trace), lines-limit selector (50–500), text search, pause/resume with buffering, live/paused pulsing indicator, auto-refresh checkbox, manual refresh with spinner, copy (filtered), and clear (native confirm, truncates the backend file too).
- **Terminal-style rendering**: Black monospace terminal surface with color-coded severity badges (ERR/WRN/INF/DBG/TRC/SUC), timestamps, hover highlighting, near-bottom auto-scroll pinning, and a "showing X of Y" summary bar; backend log lines parsed from the `[date][time][module][LEVEL] message` file format.

#### 🎨 Styling (`src/index.css`)

- New console styles: controls toolbar (selects, search, action buttons, auto-refresh checkbox, live-status dot with pulse animation), terminal surface, severity badge palette, line color coding, and summary bar — all matching the existing glassmorphic dark aesthetic.

## [0.15.0] - 2026-08-16

### Round 15 — Settings Resilience & Developer Diagnostics (D3D_CURSOR-inspired)

#### ⚛️ React 19 / TypeScript Frontend (`src`)

- **Settings Backup & Restore (`DeveloperTab`, `src/lib/settingsBackup.ts`)**: Export the persisted settings to a versioned JSON backup file (Blob download) and restore from any backup via native file picker. Imports run through a strict sanitizer — unknown fields are dropped, wrong-typed values fall back to current settings, and the accent must be a known preset id — so corrupted or hand-edited backups can never break the settings engine.
- **Activity Console (`DevConsole`, `src/lib/console.ts`)**: Replaces the static IPC output box with a live, timestamped, color-coded console feed (module-level event bus, mirroring the toast pattern). IPC invocations, settings import/export/reset, and config-dir actions all stream in with level markers (INFO/SUCCESS/WARN/ERROR), plus auto-scroll toggle, copy-to-clipboard, and clear controls (200-entry ring buffer).
- **Settings load retry with exponential backoff (`PreferencesTab`)**: Initial settings load retries up to 3 times (300ms/600ms/1200ms) to survive transient IPC startup races instead of silently falling back to defaults.
- **D3D_CURSOR inspiration**: The sanitizer + import/export flow and the diagnostics console are direct ports of CursorFX Studio's preset-sharing and DiagnosticsPanel patterns.

#### 🛠️ Developer CLI & Testing Suite (`test`)

- **Sanitizer unit tests (`test/settings.test.ts`)**: 7 new tests covering pass-through, unknown-field dropping, per-field type fallback, unknown-accent rejection, primitive/null payloads, fallback immutability, and serialization round-trip — 12 total `bun test` cases.

## [0.14.0] - 2026-08-16

### Round 14 — Tray Utility & Accessibility Hardening

#### ⚛️ React 19 / TypeScript Frontend (`src`)

- **"Check for updates on launch" toggle (`PreferencesTab`)**: The previously dead `check_updates_on_launch` setting (hardcoded `true` in every IPC call, no UI) is now a real preference toggle — the Update Checker card auto-checks on mount only when enabled, and all settings writes go through a shared `saveSettings` merge helper so no preference can be silently clobbered.
- **Native update notification while hidden (`UpdateChecker`)**: When a new version is found while the window is hidden in the tray, a native OS notification (`tauri-plugin-notification`) surfaces it — the only channel that reaches the user without opening the GUI.
- **Active tab persistence (`App.tsx`)**: The last active tab is remembered in `localStorage` and restored on next launch, so the app reopens on the same view it was closed on.
- **Diagnostic report download (`AboutTab`)**: New "Save Report" button exports a timestamped diagnostics `.txt` via Blob download, sharing the same markdown builder as Copy Diagnostics.
- **Keyboard Shortcuts modal accessibility**: Proper focus trap (Tab wraps at both ends, Shift+Tab backwards), focus restore on close, initial focus into the dialog, and `aria-describedby` wiring — no new shortcuts added.
- **Removed dead prop**: `onAccentChange` (a no-op passed by `App.tsx`) removed from `PreferencesTab`.

#### 🦀 Rust Backend (`src-tauri`)

- **Notification plugin**: Registered `tauri-plugin-notification` and granted `notification:default` capability for native OS notifications.

#### ♿ Accessibility & CSS (`src/index.css`)

- **`prefers-contrast: more`**: Strengthened borders, toggle contrast, and card outlines so frosted glass never washes out interactive boundaries.
- **`prefers-reduced-transparency: reduce`**: Removes backdrop blur in favor of near-solid surfaces for users who disable desktop transparency.
- **`forced-colors: active`**: Selection/active states (tabs, accent swatches, switches, badges, buttons) expressed via borders so state is never conveyed by color alone.

## [0.13.0] - 2026-08-16

### Round 13 Part 2 — S2B2S Tooling Borrowings & Lint Hardening

#### 🛠️ Tooling

- **oxlint Lint Pipeline**: Replaced the ESLint-on-TypeScript-7 setup (its parser breaks under TS 7) with **oxlint** (`@oxlint/cli`), adding `lint`/`lint:fix` scripts, `.oxlintrc.json` (correctness/suspicious/perf categories plus react/unicorn/import/typescript plugins), oxlint integrated into the 6-step `before-commit --full` suite and the pre-commit git hook, and the `oxc-vscode` extension in `.vscode/extensions.json`.

- **RTK Auto-Updater (`scripts/update-rtk.ts`)**: New `update:rtk` script that queries the GitHub tags API for `rtk-ai/rtk`'s latest tag and runs `cargo install --git https://github.com/rtk-ai/rtk --tag <tag> --force` — no manual tag pin required (`--check` / `--tag <t>` / `--help` flags available).
- **CI Hardening** (`.github/workflows/ci.yml`, S2B2S-inspired): concurrency groups with `cancel-in-progress`, `bun install --frozen-lockfile` for reproducible builds, `swatinem/rust-cache@v2` for fast Cargo caching, a dedicated `cargo test` step to exercise the embedded Rust unit tests, `workflow_dispatch` manual trigger, and `actions/checkout@v4`.

## [0.12.0] - 2026-08-14

### Deep Audit Round 13 — Ultimate Desktop Starter Template Overhaul

Major architectural expansion transforming the template into the definitive cross-platform starter kit for desktop development.

#### ⚛️ React 19 / TypeScript Frontend (`src`)

- **Theme Accent Customization Engine (`src/lib/theme.ts`)**: 5 curated neon accent palettes (**Cyan Glow**, **Emerald Matrix**, **Violet Neon**, **Amber Gold**, **Rose Pink**) with dynamic CSS custom property injection and disk persistence.
- **Reactive Toast Notification System (`src/components/Toast.tsx`, `src/lib/toast.ts`)**: Decoupled toast event bus (`toast.success()`, `toast.error()`, `toast.warning()`, `toast.info()`) with animated auto-dismiss timers and accessible ARIA live regions.
- **Developer Hub & IPC Playground (`src/components/DeveloperTab.tsx`)**: Dedicated interactive developer tab with a live IPC command inspector (`get_app_info`, `get_app_settings`, `get_system_stats`), toast test bench, and quick factory reset tools.
- **Global Keyboard Shortcuts & Modal (`src/components/KeyboardShortcutsModal.tsx`, `src/lib/shortcuts.ts`)**: Global hotkeys (`Ctrl+1..3`, `Ctrl+,`, `Ctrl+/`, `?`, `Esc`) with a glassmorphic cheat sheet dialog.
- **Top-Level Error Boundary (`src/components/ErrorBoundary.tsx`)**: React 19 class Error Boundary providing a graceful frosted glass crash card with stack trace details, log copy, and app reload actions.
- **Config Directory Quick Opener**: Added a 1-click button in `AboutTab` to open the native OS `%APPDATA%` / configuration folder in File Explorer / Finder.

#### 🦀 Rust Backend (`src-tauri`)

- **Multi-Field `AppSettings` Persistence**: Expanded settings struct with `theme_accent`, `start_minimized`, `check_updates_on_launch`, and `minimize_to_tray`.
- **New Tauri IPC Commands**: Added `get_app_settings`, `update_app_settings`, `reset_app_settings`, `get_system_stats`, and `open_app_data_dir`.
- **Background Launch Support**: If `start_minimized` is enabled, the app launches directly into the system tray without surfacing the main window.
- **Embedded Rust Unit Tests**: Added unit tests in `src-tauri/src/lib.rs` verifying JSON serialization, atomic save/load, default values, and mutex poison recovery.

#### 🛠️ Developer CLI & Testing Suite (`scripts` & `test`)

- **1-Command Project Customizer (`scripts/rename-project.ts`)**: `bun run rename-project` CLI script to automatically rebrand and rename the entire starter template (package name, Rust crate, bundle identifier, window titles, repo URLs) in one second.
- **Automated Bun Unit Test Suite (`test/version.test.ts`, `test/theme.test.ts`)**: Unit tests executing via `bun test` in <250ms.
- **Pre-commit Regex Tolerance**: Fixed `scripts/before-commit.ts` to support both single and double quotes in `scripts/version.ts`.
- **oxlint Linting Pipeline (TS7-compatible)**: Replaced ESLint with **oxlint** (`.oxlintrc.json`) — correctness/suspicious/perf categories plus React, unicorn, import, and typescript plugins. New `bun run lint` / `bun run lint:fix` scripts; the `--full` pre-commit suite is now a **6-step gate** (lint inserted as step 3), the git pre-commit hook enforces lint, and CI runs `bun run lint` on all three OS runners. Codebase lint-clean with zero findings; `tsconfig.scripts.json` bumped to ES2023 for `toSorted()`. VSCode now recommends the oxlint extension with on-type linting.

## [0.11.0] - 2026-08-14

### Deep Audit Round 12 — Template Excellence, Accessibility & Hardened Persistence

Full architectural audit and enhancement elevating this starter template to production gold standard.

#### ⚛️ React 19 / TypeScript Frontend (`src`)

- **Copy Diagnostics utility**: `AboutTab` now includes a 1-click "Copy Diagnostics" button that copies formatted markdown diagnostic data (app version, Tauri core version, OS, CPU architecture, runtime stack) to the clipboard with animated confirmation feedback.
- **WAI-ARIA tabpanel navigation**: Added `tabIndex={0}` to both `PreferencesTab` and `AboutTab` `role="tabpanel"` containers, completing the WAI-ARIA authoring practices pattern by allowing keyboard users to Tab directly into active panel content.
- **Disabled toggle support**: `ToggleSwitch` now accepts an optional `disabled` prop with full `aria-disabled`, `tabIndex={disabled ? -1 : 0}`, Space/Enter keyboard guards, and `:disabled` visual styling.
- **Environment-aware header badge**: The header tray badge dynamically detects whether the app is running in native Tauri desktop mode (`isTauri === true`, rendering "System Tray Active" with cyan pulsing indicator) or in browser dev preview (`isTauri === false`, rendering "Web Preview").
- **Listener cleanup lifecycle**: Hardened `UpdateChecker` event listener registration and teardown using an `isMounted` ref guard to eliminate potential listener leaks during fast unmount cycles.
- **Download progress clamping**: Bounded update download percentage calculation with `Math.min(Math.max(pct, 0), 100)`.
- **Nullish coalescing consistency**: Replaced all remaining `||` fallbacks in `AboutTab` with `??` (`appInfo?.os ?? "unknown"`, `appInfo?.arch ?? "unknown"`).

#### 🦀 Rust Backend (`src-tauri`)

- **Atomic disk settings persistence**: `save_settings_to_disk` now implements atomic write-and-rename (writing to `settings.json.tmp` before atomically replacing `settings.json`), ensuring unexpected power loss or process crashes can never result in a corrupt or 0-byte configuration file.

#### 🎨 CSS (`src/index.css`)

- **Tactile button micro-interactions**: Added active state transforms (`transform: scale(0.97)`) across all interactive button classes (`.tab-btn`, `.btn-update-primary`, `.btn-update-secondary`, `.btn-copy-diagnostics`, `.btn-footer-check`, `.btn-update-footer`).
- **Environment badge styles**: Added dedicated styling for `.tray-status-badge.tray-active` (neon cyan pulse) and `.tray-status-badge.web-preview` (subtle border and amber indicator).
- **Copy diagnostics UI**: Added frosted glass button styling with emerald confirmation state (`.btn-copy-diagnostics.copied`).
- **Disabled switch styling**: Added disabled cursor and muted opacity rules for `.setting-item.disabled` and `.switch.disabled`.

#### 🛠️ Pro Developer Workflow & Pre-Commit Pipeline (`scripts/before-commit.ts`)

- **Full Verification Suite (`bun run validate` / `bun run before-commit --full`)**: Runs all 5 quality gates sequentially (Version Check → TypeScript `tsc -b` → Production `vite build` → Native `cargo check` → Architecture Map generation) in ~2s with per-step timing metrics.
- **Custom Version Setter (`--set <semver>`)**: Allows setting custom SemVer strings directly and propagating them across all mirrors.
- **Auto-Staging (`--stage`)**: Automatically stages updated mirror files with `git add`.
- **Pre-Commit Hook Quality Gates (`--install-hook` / `--uninstall-hook`)**: Installs a `.git/hooks/pre-commit` hook enforcing version sync and strict TypeScript type checking on every commit attempt.

#### 📚 Comprehensive Documentation Suite (`.md` Files)

- **Cross-platform build guide (`BUILD.md`)**: Full multi-platform build instructions across Windows, macOS, and Linux covering toolchains, live dev mode, production packaging, and deep troubleshooting (e.g. Windows `MAX_PATH` path limits, Linux WebKit2GTK dependencies, macOS Gatekeeper).
- **Testing & QA guide (`TESTING.md`)**: Detailed documentation of the 5-step automated pre-commit validation suite (`bun test` / `bun run validate`) and a complete manual desktop testing matrix covering tray actions, window lifecycle, and update simulation.
- **Contributor guide & standards (`CONTRIBUTING.md`)**: Detailed contribution guidelines, Git branching strategy (`feature/*`, `fix/*`, `refactor/*`, `docs/*`), Conventional Commits specification, and coding rules for Rust and React 19 / TypeScript 7.
- **Security architecture & policy (`SECURITY.md`)**: Comprehensive documentation of Tauri v2 capability scoping, atomic persistence guarantees, credential protection patterns (Windows DPAPI / macOS Keychain), and responsible vulnerability disclosure process.
- **Developer & AI agent cheat sheet (`CRUSH.md`)**: Rapid reference cheat sheet with copy-paste code patterns for Tauri IPC, React 19 component skeletons, Rust error handling contracts, and Bun CLI scripts.
- **Licensing & attribution (`LICENSE`, `THIRD_PARTY_LICENSES.md`)**: Standard MIT project license and complete open-source attribution for bundled assets (Inter font OFL-1.1, Lucide icons MIT, Tauri 2, React 19, Bun).

#### 🛠️ Repository Standards, Tooling & Build Optimization

- **Line-ending & binary protection (`.gitattributes`)**: Normalized text files to LF (`* text=auto eol=lf`), preserved CRLF for Windows scripts, and declared explicit binary protection for icons, fonts, and binaries.
- **Cross-editor configuration (`.editorconfig`)**: Multi-editor configuration standardizing indentation (2 spaces for JS/TS/CSS/JSON/MD, 4 spaces for Rust), UTF-8 encoding, and whitespace trimming.
- **Cargo dev build speed optimization (`src-tauri/Cargo.toml`)**: Added `[profile.dev] incremental = true` and `[profile.dev.package."*"] debug = false` to skip dependency debuginfo generation for faster live dev reload.
- **Prettier formatting pipeline**: Added `.prettierrc` and `.prettierignore` with automated formatting scripts (`bun run format`, `bun run format:check`, `bun run format:frontend`, `bun run format:backend`).
- **VS Code workspace integration**: Added `.vscode/extensions.json` and `.vscode/settings.json` configuring format-on-save, Prettier default formatter, and `rust-analyzer` integration.
- **Automated multi-platform release workflow (`.github/workflows/release.yml`)**: Automated Tauri 2 GitHub Actions release pipeline building Windows, macOS (Universal/ARM/Intel), and Linux bundles, extracting release notes from `CHANGELOG.md`, creating GitHub Draft Releases, and publishing signed updater bundles (`latest.json`).
- **CI format validation**: Added `bun run format:check` to `.github/workflows/ci.yml` test matrix.

## [0.10.4] - 2026-08-03

### Deep Audit Round 11 — Correctness, Type-Safety & Polish

Full-pass audit of every source file with targeted bug fixes, stricter type checking, and cleanup.

#### ⚛️ React 19 / TypeScript Frontend (`src`)

- **Nullish fallback consistency**: `AboutTab`'s "Tauri Core Engine" tile now uses `??` instead of `||` for the `tauri_version` fallback — `||` would incorrectly fall back on an empty string; `??` only falls back for `null`/`undefined` (matching the `version` field's Round 10 fix).
- **Stale error banner cleared on install**: `UpdateChecker.installUpdate` now clears `errorMessage` at the start, so a previous failed check's error banner doesn't linger during a new install.
- **Re-fetched update surfaced in UI**: When `installUpdate` re-fetches an update (because `pendingUpdateRef` was null), it now sets `updateAvailable`, `latestVersion`, `releaseNotes`, etc. so the card/footer reflect the newly discovered version.
- **Footer check button a11y**: The footer's icon-only "Check Updates" button now carries `aria-label="Check for updates"` for screen readers.
- **Stricter TypeScript**: `tsconfig.json` and `tsconfig.scripts.json` now enable `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; all 19 latent type errors this surfaced across the scripts were fixed.

#### 🦀 Rust Backend (`src-tauri`)

- **Minimized-window surfacing**: `show_window_if_hidden` now also unminimizes/focuses a minimized-but-visible window when "Check for Updates" is triggered from the tray.
- **`AppSettings` derives `Clone`**: `set_minimize_to_tray` now clone-modifies the current settings instead of reconstructing the struct from scratch.
- **Config-dir fallback logging**: `app_config_dir()` failure now logs a descriptive `[settings]` warning to stderr instead of silently falling back to the current directory.

#### 🎨 CSS (`src/index.css`)

- **Scoped `user-select`**: `user-select: none` moved from the global `*` selector to `.app-container` + interactive children, so informational content (About notes, tile values, release notes) remains selectable. Added `user-select: text` to `.tile-value` and `.notes-list`.

#### 🛠️ Tooling & Scripts (`scripts`)

- **`generate-arch.ts` Cargo.lock path fixed**: The description registry key was `"Cargo.lock"` but the actual path is `src-tauri/Cargo.lock` — the lockfile now gets its proper description in ARCHITECTURE.md.
- **`package.json` redundant `dev` script removed**: Identical to `bun run tauri dev`.

#### 📖 Documentation

- `README.md`: `rtk` prefix rule clarified — sanctioned Bun scripts (`bun run ...`) run directly without the `rtk` wrapper (matches AGENTS.md).
- `ARCHITECTURE.md`: Regenerated.

## [0.10.3] - 2026-08-03

### Deep Audit Round 10 — Correctness, Cleanup & Documentation

Full-pass audit of every source file with targeted improvements and bug fixes.

#### ⚛️ React 19 / TypeScript Frontend (`src`)

- **Nullish coalescing in `AboutTab`**: `appInfo?.version || __APP_VERSION__` → `appInfo?.version ?? __APP_VERSION__` — `||` would incorrectly fall back to `__APP_VERSION__` if the version string were ever an empty string; `??` only falls back for `null`/`undefined`, which is the intended semantics.

#### 📖 Documentation

- `ARCHITECTURE.md`: `generate-arch.ts` file descriptions registry now includes `Cargo.lock` (committed lockfile, not gitignored, previously unlisted).
- `CHANGELOG.md`: This entry.

#### 🧹 Cleaning

- `index.css`: Removed trailing blank line at end of file.

## [0.10.2] - 2026-08-03

### Deep Audit Round 9 — Concurrency, Accessibility & Drift Cleanup

Full-pass audit of every doc, source file, and script (bug fixes, dead-code removal, refactoring, commenting — no new behavior).

#### ⚛️ React 19 / TypeScript Frontend (`src`)

- **Cross-instance install race fixed**: `UpdateChecker` now guards `downloadAndInstall` with a module-level `installInFlight` flag shared by every variant — the card (Preferences tab) and footer are separate component instances with independent refs, so simultaneous "Install" clicks on both could previously start two concurrent downloads of the same update. The shared flag makes the install process-wide.
- **Stale update handle cleared on check failure**: `pendingUpdateRef` is nulled when a check throws, so a previously offered update can never be installed after the check that offered it has failed (e.g. network went down mid-check).
- **Error banner now `role="alert"`**: update failures interrupt screen readers immediately instead of waiting for the footer's polite-live pass.
- **`ToggleSwitch` double-announcement fixed**: the visually-hidden native checkbox is now `aria-hidden="true"` — the label's `role="switch"` + `aria-checked` already expose the on/off semantics, so screen readers no longer announce the control twice (once as switch, once as checkbox).
- **Tauri-version fallback de-drifted**: `AboutTab`'s "Tauri Core Engine" tile now falls back to `WEB_PREVIEW_APP_INFO.tauri_version` instead of a hardcoded `"2.11"` that could silently diverge from the compiled `tauri::VERSION`.
- **Tab bar deduplicated**: `App.tsx` renders both tab buttons from a single `TABS` array (id / label / icon), eliminating ~25 lines of duplicated markup — the ARIA wiring (`aria-selected`, `aria-controls`, roving `tabIndex`) can no longer drift between the two tabs.

#### 🛠️ Tooling & Scripts (`scripts`)

- **`before-commit.ts` crate-name hygiene**: the `Cargo.lock` root-crate regex now interpolates `CARGO_CRATE_NAME` instead of a hardcoded `"minimalistic-app"` literal — renaming the crate (per the "From Template to Your App" flow) can no longer silently break the lockfile drift check.
- **Dead description removed**: `generate-arch.ts` dropped its `ARCHITECTURE.md` registry entry — the file is self-excluded from the repomix collection (`repomix.config.json`), so the entry was unreachable.
- **Script consistency**: `package.json` `update-deps` now runs `bun scripts/update-deps.ts` like every other script (was `bun run scripts/...`).

#### 📖 Documentation

- `README.md`: tech-stack table refreshed to the actual pinned versions — React `19.3.0-canary-*` (exact-pinned canary build) and TypeScript `7.1.0-dev.*` (nightly, `next` channel) replace the stale `^19.2.8` / `^7.0.2` entries that had drifted from `package.json` since Round 8.1.

## [0.10.1] - 2026-08-01

### Publisher-Agnostic Prerelease Selection & Freshest-Canary Refresh

#### ⚛️ Stack (`package.json`)

- **`react` / `react-dom` → `19.3.0-canary-cbb046ab-20260731`**: refreshed to the freshest published canary build (2026-07-31), replacing the 2026-05-07 build that the previous tag-order heuristic had selected. Exact-pinned and fully validated (tsc → Vite build → cargo check).

#### 🛠️ Tooling (`scripts/update-deps.ts`)

- **Publisher-agnostic prerelease selection**: `--prerelease` no longer stops at the first qualifying dist-tag in a fixed order. EVERY tag is now evaluated and the best **strictly-newer** candidate wins. Ranking: highest SemVer core first; for equal cores, the **newest publish date** (packument `time` field) — this is what un-stuck react's `canary` tag (published 07-31) from the older `next` build (05-07) that sorts lexically _higher_. A lexical SemVer comparison is only the last-resort tiebreak.
- **Tag pool widened**: `experimental`, `insiders`, and `dev` join `next`/`beta`/`rc`/`alpha`/`canary` as probed keywords, covering publisher-specific channels (react's `experimental`, typescript's `dev`/`insiders`). Stale pointers (react `experimental` → `0.0.0-experimental-*`, typescript `dev` → `3.9.4`, `insiders` → `4.6.2`) are still rejected by the core-version gate.
- **Publish-date-aware upgrade gate**: a same-core build published later than the installed build now counts as a genuine upgrade (previously rejected when its build hash sorted lexically lower), and the `latest`-tag fallback is only returned when it is itself strictly newer — `null` means "nothing newer exists", eliminating the downgrade-to-stable proposals the old string-inequality check produced.
- **Step 4b clobber guard hardened**: the re-pin pass now restores **every** prerelease pin in the pre-refresh snapshot (spec-based diff vs. `bun update --latest`'s rewrite), not just the deps the current run targeted. This fixed a verification-caught regression where an already-pinned `typescript 7.1.0-dev.*` was silently downgraded to `7.0.2` — and the pipeline then validated against the wrong compiler.

#### 📖 Documentation

- `README.md`: `--prerelease` flag description updated with the full tag list and the new selection rules.

## [0.10.0] - 2026-08-01

### Prerelease Channels & Stack Adoption — Canary React + Dev TypeScript

#### ⚛️ Stack (`package.json`)

- **`react` / `react-dom` → `19.3.0-canary-d5736f09-20260507`**: Frontend moved to the React 19.3 canary channel (approved deliberately — canaries are unstable by design). Pinned to the exact build (never a floating tag) so `bun install` is deterministic.
- **`typescript` → `7.1.0-dev.20260801.1`**: TypeScript compiler moved to the 7.1 dev/nightly channel, resolved via the `next` dist-tag with the SemVer guard.
- Full pipeline validation passed on the new stack: `tsc -b` ✅, Vite production build ✅, `cargo check` ✅.

#### 🛠️ Tooling (`scripts/update-deps.ts`)

- **Prerelease clobber guard (step 4b)**: Found and fixed a real bug during the first real `--prerelease` run — `bun update --latest` resolves the `latest` dist-tag and **rewrites package.json specs**, silently downgrading exact prerelease pins (`react-dom 19.3.0-canary-d5736f09-20260507 -> 19.2.8`) while stripping range operators. The pipeline now re-runs `bun add <pkg>@<target>` after the transitive refresh whenever prerelease mode upgraded a direct NPM dependency, and hard-fails if the re-pin fails. Stable mode is unaffected (`@latest` pins survive unchanged).
- Dry-run preview and `--help` now document the 4b re-pin step.

## [0.9.1] - 2026-08-01

### Deep Audit Round 8.1 — update-deps Pre-Release & Dry-Run Modes

#### 🛠️ Tooling (`scripts/update-deps.ts`)

- **`--prerelease` flag**: The update pipeline can now prefer **beta / alpha / RC versions** for direct dependencies instead of stable-only `@latest`. NPM packages resolve prerelease dist-tags in order (`next`, `beta`, `rc`, `alpha`, `canary`) and crates.io uses `newest_version`. A prominent warning banner explains that prereleases are unstable and that compatibility is still enforced by the pipeline's validation steps (tsc → Vite build → cargo check).
- **`--dry-run` flag**: New read-only preview mode that queries both registries and prints a "would upgrade" report (dependency, current → target, prerelease markers) plus the list of steps a real run would execute — **without writing anything** (no `bun add`, no Cargo.toml edits, no lockfile refreshes, no builds). Safe to run at any time; exits 0.
- **SemVer downgrade guard**: Prerelease resolution now uses a dependency-free SemVer comparator that rejects any candidate **strictly older** than the installed version. This fixed a real bug discovered while testing: stale dist-tags (e.g. `@tauri-apps/api`'s `next` tag → `2.0.1` while the project uses `^2.11.1`, `tauri-build`'s `newest_version` → `1.5.7-edition2024.0`, `vite` → `8.2.0-beta.0`) were previously proposed as "upgrades" that would actually have downgraded the stack. Only genuinely newer prereleases survive (e.g. `react 19.3.0-canary-*`, `typescript 7.1.0-dev.*`).
- **Flag hygiene**: `--dry-run` is the single preview flag — a temporary `--check` alias was removed during the same round to avoid two names for one behavior.
- **`--help`**: Prints the updated usage summary for all flags.

#### 📖 Documentation

- `README.md`: the update-deps SOP section now documents `--prerelease` / `--dry-run` / `--help` with a behavior table (downgrade guard, stable default, transitive resolution note).
- `AGENTS.md`: Common Tasks table gained rows for the dry-run preview and prerelease upgrade commands.

## [0.9.0] - 2026-08-01

### Deep Audit Round 8 — Documentation Deep-Dive & Component Extraction

#### 📖 Documentation Overhaul (README.md)

- **Unified SOP**: The README's Standard Operating Procedure now matches `AGENTS.md` exactly — 7 steps including the environment verification step (`bun --version` / `cargo --version`) that was previously missing.
- **Deep-dive Key Features**: Expanded each feature section with detailed mechanics: a tray event-flow breakdown (left-click toggle → right-click menu → quit teardown), a complete IPC command table (`get_minimize_to_tray`, `set_minimize_to_tray`, `get_app_info`), a per-OS settings file path table, and a version-sync file graph tracing `scripts/version.ts` → mirrors → Vite `define`.
- **New "From Template to Your App" section**: A step-by-step rebranding checklist (product name, app identifier, crate name, icon regeneration, Minisign keys, GitHub endpoints, window title) so the template can be forked into a real app without missing a location.
- **Annotated project structure**: Every file now carries a "what it does / when to touch it" note, and a troubleshooting cheatsheet was added (WebView2 devtools, Linux tray dependencies, Minisign misconfiguration).

#### 📖 Agent Guidelines (AGENTS.md)

- **Golden Rule promoted**: The `rtk` command prefix rule (always use `rtk` before shell commands) is now part of the Primary Standard section, not just the release procedure.
- **Expanded Best Practices**: Documented the IPC error pattern (`Result<(), String>` + frontend optimistic rollback), the `UpdateChecker` ref-based concurrency-guard pattern, the `ToggleSwitch` accessibility contract, and the inline-comment standard.
- **New "Common Tasks" quick-reference table**: rename the app, bump the version, add a dependency, regenerate icons, run the CI checks — one row per task with the exact command.

#### 📖 Auto-Update Documentation (AUTO-UPDATE.md)

- **Stale examples fixed**: Release-tag example updated (`v0.1.1` → `v0.9.0`) and the `latest.json` feed schema example refreshed to the current template version.
- **"Your First Release" walkthrough**: End-to-end first-publish flow (repo links → keys → secrets → tag → verify feed) with a checklist.
- **Troubleshooting section**: Endpoint 404, Minisign public-key mismatch, missing `TAURI_SIGNING_PRIVATE_KEY` secrets, CSP `connect-src` requirements, and capabilities (`updater:default`, `process:default`) explained.

#### 📖 Changelog (CHANGELOG.md)

- **Duplicate version header fixed**: Round 6 (version-drift fixes) and Round 7 (single-source version management) were both committed under `0.8.1`, producing two identical `## [0.8.1]` headers. Round 7 is renumbered to `## [0.8.2] - 2026-08-01`; Round 6 keeps `0.8.1`. Each version now appears exactly once, restoring Keep-a-Changelog compliance and making `before-commit --check` changelog validation unambiguous.

#### ⚛️ React 19 / TypeScript Frontend (`src`)

- **Tab panels extracted into components**: `App.tsx` shrank from ~316 to ~160 lines by moving the two tab views into `src/components/PreferencesTab.tsx` (owns autostart + minimize-to-tray state, toggle handlers, and their IPC initialization; receives an `onStatusChange` prop for the shared footer status) and `src/components/AboutTab.tsx` (pure presentational; also exports the `AppInfo` interface and `WEB_PREVIEW_APP_INFO` fallback). `App.tsx` is now the application shell: tablist, header, footer, app-info loading, status bar.
- **React `<StrictMode>` enabled** in `main.tsx`: standard React 19 best practice; surfaces double-invoke bugs during development (production output unaffected). All mount effects are idempotent / guarded, so dev double-mounting is harmless.
- **Neutral web-preview fallback completed**: `WEB_PREVIEW_APP_INFO.arch` is now `"unknown"` (it still claimed `"x86_64"` from Round 6's neutrality fix); the browser-preview tile no longer assumes a CPU architecture.
- **Complete ARIA tabs keyboard pattern**: `Home` / `End` keys now jump to the first / last tab (roving `tabIndex`), completing the WAI-ARIA tabs pattern alongside `ArrowLeft` / `ArrowRight`.
- **`UpdateChecker` state hygiene**: `showNotes` (release-notes drawer) resets to false whenever a new update is found, preventing a stale open drawer when checking again.
- **Anti-flash styling**: `index.html` now sets `color-scheme: dark` meta and an inline black background, so the webview never flashes white between document load and CSS parse.

#### 🤖 CI/CD & Tooling (`.github` & `scripts`)

- **CI now guards version drift**: `.github/workflows/ci.yml` gained a `bun run before-commit --check` step, so any mirror drift (package.json / Cargo.toml / tauri.conf.json / Cargo.lock vs. `scripts/version.ts`) fails the pipeline on push and pull request — the same check the git pre-commit hook installs locally.

## [0.8.2] - 2026-08-01

### Deep Cross-Platform Audit & Optimization — Round 7

#### 🔢 Single-Source Version Management (`scripts/version.ts` + `scripts/before-commit.ts`)

- **Global version constant**: New `scripts/version.ts` exports `APP_VERSION` — the single place the application version is defined. Every other occurrence is now a synced mirror or a build-time derivation.
- **`bun run before-commit`**: New `scripts/before-commit.ts` propagates `APP_VERSION` to `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and refreshes the `Cargo.lock` root crate entry via `cargo update` — eliminating the hardcoded-copy drift that has now been fixed twice in this template's history.
- **Modes**: default sync mode prints a per-mirror report; `--check` validates read-only and exits 1 on drift (CI / git hooks); `--bump <major|minor|patch>` increments the global and syncs the whole chain; `--install-hook` wires a `.git/hooks/pre-commit` running `--check`. Changelog header presence for the current version is validated (advisory warning).
- **Vite derive**: `vite.config.ts` now imports `APP_VERSION` from `scripts/version.ts` (replacing the `package.json` JSON import), so `__APP_VERSION__` and the web-preview fallback can never drift from the global.
- **Audited every legacy version string** (`0.1.0`–`0.8.0`): confirmed no hardcoded app versions remain in `src/` or `src-tauri/src/`; remaining old numbers are intentional (CHANGELOG release history, AUTO-UPDATE.md feed schema examples, third-party lockfile entries).

## [0.8.1] - 2026-08-01

### Deep Cross-Platform Audit & Optimization — Round 6

#### 🔧 Version Drift & Consistency Fixes

- **Version drift fixed**: `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` still declared `0.7.0` while the changelog/commit already described v0.8.0 — all three bumped to `0.8.0` (single source of truth restored).
- **`set_minimize_to_tray` memory/disk/UI consistency**: The IPC handler now persists the new value to disk _first_, then commits it to memory. Previously memory was mutated before the disk write, so a failed write left in-memory state diverged from both the UI (rolled back) and disk. A no-op early return also skips redundant disk writes when the value is unchanged. The now-unused `Clone` derive on `AppSettings` was removed.
- **Non-panic icon bootstrap**: `default_window_icon().expect(...)` panicked the process on misconfiguration; it now returns a descriptive setup error so the app fails the launch gracefully.

#### 🦀 Rust Backend (`src-tauri`)

- **Tray tooltip de-hardcoded**: `TrayIconBuilder::tooltip` now reads the product name from `AppHandle::package_info()` so it can never drift from `tauri.conf.json`.
- **`show_window_if_hidden()` helper extracted**: Deduplicated the show-if-hidden sequence in the "Check for Updates..." tray menu handler.

#### ⚛️ React 19 / TypeScript Frontend (`src`)

- **Full ARIA tabs keyboard pattern**: The tablist now implements roving `tabIndex` (active tab `0`, inactive `-1`) plus ArrowLeft / ArrowRight navigation that switches tabs and moves focus — completing the WAI-ARIA tabs pattern beyond the existing `aria-selected`/`aria-controls` wiring.
- **Neutral platform fallbacks**: The System & About platform tile falls back to `unknown` instead of Node.js-style `"win32"` / assumed `"x86_64"` (Rust reports `"windows"`).
- **Footer update status announces to screen readers**: The footer `UpdateChecker` container is now `aria-live="polite"` alongside the existing footer status region.

#### 🛠️ Tooling, CI/CD & Docs

- **Deprecated CI runner updated**: `ubuntu-22.04` (retired by GitHub Actions) → `ubuntu-24.04` in `.github/workflows/ci.yml` and the release workflow template in `AUTO-UPDATE.md`.
- **`update-deps.ts` regex hygiene**: Replaced the stateful `RegExp.test()` lastIndex quirk in the Cargo.toml updater with unconditional dual-form replacements (inline + simple spec forms are mutually exclusive per line).

## [0.8.0] - 2026-08-01

### Deep Cross-Platform Audit & Optimization — Round 5

#### 🦀 Rust Backend (`src-tauri`)

- **Single-instance enforcement**: Added `tauri-plugin-single-instance` (`^2.4.3`), registered first in the builder. Launching the app a second time now focuses the existing window instead of spawning a duplicate tray icon — the standard guard for tray-utility apps.
- **Version/name drift eliminated**: `get_app_info` now reads `name` and `version` from `AppHandle::package_info()` (single source of truth: `tauri.conf.json`) instead of a hardcoded string + `env!("CARGO_PKG_VERSION")`. The frontend's `AppInfo` fields became `String`s accordingly.
- **Mutex no longer held during disk I/O**: `set_minimize_to_tray` mutates in-memory state, clones a snapshot, drops the lock, then persists. The lock is now held only for memory mutation, never blocking IPC during a disk write.
- **Corrupt/missing settings no longer silent**: `load_settings_from_disk` logs descriptive `[settings]` warnings to stderr when the file is unreadable or fails JSON parsing (missing file still quietly falls back to defaults).
- **Derive cleanup**: `AppSettings` drops unused `Debug`; `AppInfo` drops unused `Debug`/`Clone`/`Deserialize`, keeping only the derives each type actually needs.

#### ⚛️ React 19 / TypeScript Frontend (`src`)

- **Extracted `ToggleSwitch` component** (`src/components/ToggleSwitch.tsx`): The two 45-line duplicated ARIA switch blocks in `App.tsx` are now a single reusable, keyboard-accessible component (`role="switch"`, Space/Enter activation, visually-hidden checkbox). `App.tsx` shrank by ~55 lines and dropped its ad-hoc `handleKeyDown`.
- **Version fallback fixed**: The System & About "Application Version" tile falls back to `__APP_VERSION__` (Vite-injected) instead of the stale hardcoded `"0.1.0"`.
- **`UpdateChecker` timer hygiene**: The "up to date" timeout now nulls its ref after firing, and the `unlisten()` cleanup guards against unhandled promise rejections on unmount.

#### 🛠️ Tooling & Scripts (`scripts`)

- **Hard-fail semantics in the update pipeline**: `update-deps.ts` Steps 1, 2, and 4 now `process.exit(1)` when `bun add` / `bun update --latest` / `cargo update` fail (previously failures were logged and the pipeline silently continued).

## [0.7.0] - 2026-08-01

### Deep Cross-Platform Audit & Optimization — Round 4

#### 🦀 Rust Backend (`src-tauri`)

- **macOS menu-bar-only mode**: `ActivationPolicy::Accessory` is now applied on macOS (`cfg(target_os = "macos")`), hiding the Dock icon so the app behaves as a pure menu-bar utility like other tray-first macOS apps. Windows/Linux behavior unchanged.
- **Poison-safe mutex locking**: New `lock_guard()` helper recovers from `PoisonError` instead of panicking, applied to all four `Mutex` lock sites (settings × 2, is_quitting × 2).
- **Disk-write errors now surface to the UI**: `save_settings_to_disk()` and the `set_minimize_to_tray` IPC command return `Result<(), String>` with descriptive messages. The frontend's existing optimistic-rollback logic now triggers on real disk failures instead of silently ignoring them.
- **`&PathBuf` → `&Path`**: Settings load/save helpers now accept `&Path`, the idiomatic borrowed path type (fewer dependencies on the concrete container).
- **Extracted `show_and_focus_window()` helper**: Removes the third copy of the show/unminimize/focus sequence between tray left-click, "Open" menu item, and "Check for Updates" menu item.

#### ⚛️ React 19 / TypeScript Frontend (`src`)

- **Version drift eliminated**: `vite.config.ts` now injects `__APP_VERSION__` (from `package.json`) via Vite `define`, replacing the hardcoded `0.6.0` in the `WEB_PREVIEW_APP_INFO` fallback. New `src/vite-env.d.ts` declares the constant. Vite's native-config warning resolved via JSON import attributes (`with { type: "json" }`).
- **Complete ARIA tab wiring**: Navigation is now a proper `role="tablist"` with `role="tab"` buttons carrying `aria-controls`, and both panels are `role="tabpanel"` with `aria-labelledby` and stable `id`s.
- **Live status announcements**: Footer status region is now `aria-live="polite"` so screen readers announce preference and update status changes.
- **Update download progressbar**: The progress track now exposes `role="progressbar"` with `aria-valuemin/max/now`.
- **Footer error feedback**: The footer `UpdateChecker` variant now displays update-check failures inline (`text-error` status label) instead of silently reverting to the idle state.
- **Icon-only button a11y**: Release-notes toggle uses `aria-label` + `aria-expanded` instead of a `title` tooltip.

#### 🎨 CSS (`src/index.css`)

- Added `color-scheme: dark` to `:root`, forcing native dark scrollbars and form controls in all embedded webviews (WebView2, WKWebView, WebKitGTK).
- Added `.update-status-label.text-error` for the new footer error display.

#### ⚙️ Config, Tooling & Cross-Platform (`src-tauri`, `.github`, `scripts`)

- **Repomix re-integrated as the architecture engine**: `scripts/generate-arch.ts` now drives the official Repomix `pack()` API (`loadFileConfig` + `mergeConfigs` + `searchFiles` + `generateTreeString`) to produce `ARCHITECTURE.md` — gitignore-aware file inventory, per-file size/lines/tokens/chars metrics, and a box-drawing directory tree, without raw code dumps (`output.files: false`). The `repomix` devDependency (`^1.17.0`) and `repomix.config.json` were restored. Script renamed `repomix:arch` → `arch`; all references updated (README, AGENTS.md, update-deps.ts).
- **Missing `create-icons` script added**: `scripts/create-icons.ts` existed but was unreachable from `package.json`; now runnable via `bun run create-icons`.
- **Linux tray prerequisites fixed in CI & release docs**: `libappindicator3-dev` → `libayatana-appindicator3-dev` (the library Tauri v2's tray actually links against) plus `libxdo-dev`, matching Tauri's official Linux dependency list.
- **Resizable window with sane minimums**: Window is now `resizable: true` with `minWidth: 380` / `minHeight: 480`, so the preferences panel never overflows on small or high-DPI-scaled displays (Linux HiDPI, Windows scaling).
- **Architecture map descriptions**: Icon assets now get real descriptions, `vite-env.d.ts` registered, and the generator's description registry fully aligned with the Repomix-driven pipeline.

## [0.6.0] - 2026-08-01

### Deep Cross-Platform Audit & Optimization — Round 3

#### 🖼️ Cross-Platform Icon Generation (`scripts/create-icons.ts`)

- **Valid macOS `.icns`**: The previous generator wrote a raw PNG with an `.icns` extension, which is not a valid Apple Icon Image and breaks macOS bundling. The script now emits a proper ICNS container with PNG-encoded chunks (`icp4`–`ic15`, base + retina variants) — no macOS-specific tooling required.
- **Multi-resolution Windows `.ico`**: `icon.ico` now embeds 6 PNG-compressed entries (16/32/48/64/128/256) instead of a single 32×32 image.
- **Correct HiDPI assets**: `128x128@2x.png` is now a true 256×256 image (was 128×128), and `icon.png` is 512×512.

#### 🦀 Rust Backend (`src-tauri`)

- **Removed fragile settings-dir string matching**: The old logic inspected the config path with `contains("com.minimalistic.app")` / `contains("Minimalistic App")` heuristics. `app_config_dir()` is already scoped to the app identifier on Windows (`%APPDATA%\com.minimalistic.app`), Linux (`~/.config/com.minimalistic.app`), and macOS (`~/Library/Application Support/com.minimalistic.app`) — the code now uses it directly, cross-platform safe with identical on-disk paths.

#### ⚛️ React 19 / TypeScript Frontend (`src`)

- **Real status auto-clear**: `updateStatus` in `App.tsx` now implements the auto-clear timeout its doc comment promised (4s, timer reset per message, cleared on unmount).
- **Optimistic rollback**: Autostart and minimize-to-tray toggles revert their UI state if the native IPC/plugin call fails.
- **Deduplicated update checks**: The footer `UpdateChecker` no longer auto-checks on mount or listens for tray events (`autoCheckOnMount={false}`, `listenForEvents={false}`) — the settings-panel card is the single source of update checks, eliminating duplicate startup network requests.
- **Cross-platform wording**: Header badge changed from "Taskbar Tray Active" (Windows-specific) to "System Tray Active".

#### 🎨 CSS (`src/index.css`)

- Merged duplicated `.tab-btn` rules into a single block.
- Release notes and inline code now allow text selection (`user-select: text`) — the global `user-select: none` previously blocked copying update notes.
- Added thin AMOLED scrollbar styling for Chromium-based webviews.
- Added `prefers-reduced-motion` support disabling decorative animations for accessibility.

#### 🤖 CI/CD & Tooling (`.github` & `scripts`)

- **Cross-platform CI matrix**: `.github/workflows/ci.yml` now validates TypeScript, Vite bundle, and `cargo check` on `ubuntu-22.04`, `macos-latest`, and `windows-latest` (Linux system deps gated to the Ubuntu runner).
- **Consistent step labels**: `update-deps.ts` now labels all 7 pipeline steps as `Step N/7` (previously mixed `1/6`–`4/6` with `5/7`–`7/7`).
- **Accurate architecture map**: `generate-arch.ts` ignores gitignored artifacts (`src-tauri/gen`, `tsconfig.tsbuildinfo`) and derives the repository folder name dynamically instead of hardcoding `minimalistic-app`.
- **`typecheck` script**: Added `bun run typecheck` (`bun x tsc -b`) to `package.json` for one-command static validation.

## [0.5.0] - 2026-07-31

### Persistent Settings, Modular Tab Navigation & Production CI/CD

#### 🦀 Rust Backend (`src-tauri`)

- **Disk-Backed JSON Settings Persistence**: Implemented `load_settings_from_disk` and `save_settings_to_disk` in `lib.rs` targeting `$APP_DATA_DIR/<AppName>/settings.json` (explicitly nested within an application subfolder in AppData). User preferences (such as `minimize_to_tray`) now persist cleanly across application re-launches.
- **`get_app_info` IPC Command**: Added native IPC command returning app name, version, Tauri core version (`tauri::VERSION`), target OS, and architecture (`x86_64`).
- **Comprehensive Rust Documentation**: Added detailed Rust doc comments (`///`) describing thread safety (`Mutex`), Win32 WebView2 teardown mechanics, and tray lifetime rules.

#### ⚛️ React 19 / TypeScript Frontend (`src`)

- **Modular Multi-Tab Interface**: Upgraded `App.tsx` layout into a modular tab navigation system featuring **Preferences** and **System & About** views.
- **System Info & Architecture View**: Added a runtime environment tile grid displaying application version, Tauri core engine version, platform OS/arch, and template key highlights.
- **Frameless Window Drag Region**: Added `data-tauri-drag-region` to titlebar header, allowing native window repositioning across operating systems.
- **Full Keyboard ARIA Accessibility**: Added `role="switch"`, `aria-checked`, `tabIndex`, and `onKeyDown` handlers (`Space` / `Enter` keys) to switch controls, complemented by high-contrast `:focus-visible` ring indicators in CSS.
- **Release Notes Drawer**: Enhanced `UpdateChecker.tsx` with collapsible release notes preview for available updates.

#### 🤖 Tooling & CI/CD Pipeline (`.github` & `scripts`)

- **GitHub Actions CI Workflow**: Added `.github/workflows/ci.yml` running automated type checks (`bun x tsc -b`), Vite bundling, and Cargo check on every push and pull request.
- **Architecture Inventory Sync**: Re-generated `ARCHITECTURE.md` via `bun run repomix:arch`.

## [0.4.1] - 2026-07-30

### TypeScript Project References & 7-Step Pipeline Upgrade

#### 🛠️ TypeScript & Config

- **TypeScript Project References**: Configured `"composite": true`, `"types": ["node"]`, and `"outDir": "./node_modules/.tmp/scripts"` in `tsconfig.scripts.json` to enable isolated compilation of Node.js utility scripts without DOM type pollution.
- **Vite Client Types**: Added `"types": ["vite/client"]` to `tsconfig.json`, enabling TypeScript to resolve CSS side-effect imports (`import "./index.css"`) and Vite env variables cleanly.
- **`update-deps.ts` Parameter Typing**: Fixed implicit `any` parameter error in `lines.forEach((line: string) => ...)` to pass strict TS checking.
- **Git Hygiene**: Added `*.tsbuildinfo` build cache pattern to `.gitignore`.

#### 🔄 Automation & Documentation

- **7-Step Automated Update Pipeline**: Added static TypeScript verification (`bun x tsc -b`) into `scripts/update-deps.ts` as Step 5/7, ensuring type check regressions are caught automatically alongside Vite bundling and Cargo backend checks.
- **Doc Sync**: Synchronized stale `minimize_to_tray` doc comments in `lib.rs` and `App.tsx`, resolved changelog line 57 contradiction, and updated `AUTO-UPDATE.md` code snippets to match backend window visibility checks.
- **Architecture Inventory Sync**: Re-generated `ARCHITECTURE.md` via `bun run repomix:arch`.

---

## [0.4.0] - 2026-07-30

### Deep Audit & Optimization — Round 1 & 2 (46 fixes)

#### 🔐 Security Fixes

- **App starts visible** (`visible: true` in `tauri.conf.json`): Window opens normally on launch.
- **Minimize to Tray default changed to `OFF`** (`minimize_to_tray: false` in `lib.rs`, `useState(false)` in `App.tsx`): Closing the window now quits the app by default. Users can opt-in to minimize-to-tray in preferences.
- **Strict Content Security Policy** restored in `tauri.conf.json`: Was set to `null` (completely disabled). Now allows only Tauri IPC (`ipc:`, `asset:`, `http://ipc.localhost`), Google Fonts, and GitHub release endpoints.
- **Committed `bun.lock`**: Lockfile was incorrectly gitignored — reproducible builds require it to be tracked. Removed from `.gitignore`.

#### 🦀 Rust Backend

- **Removed `tauri-plugin-store`**: Plugin was registered in `lib.rs` and listed in `Cargo.toml` / `capabilities/default.json` but had zero usage anywhere in the codebase. Removed from all three locations.
- **Removed `serde`** from `Cargo.toml`: Unused — no serializable types are defined in `lib.rs`.
- **Extracted `toggle_window_visibility()` helper**: Eliminated copy-paste between the tray icon left-click handler and the "Open" menu item.
- **Fixed tray handle lifetime**: Renamed `_tray` (misleading underscore prefix) to `tray` and stored it via `app.manage(tray)` — makes the intent explicit that the handle must stay alive for the process lifetime.
- **Removed `#[derive(Default)]`** from `AppState`: The derive was misleading — `Default` would give `minimize_to_tray = false`, but the correct application default is `true`. The struct is always constructed explicitly.
- **Replaced `.unwrap()` on tray icon**: `.unwrap()` → `.expect("...")` with a descriptive message so a missing icon file produces a clear panic rather than a cryptic error.
- **Added `.tooltip("Minimalistic App")`** to `TrayIconBuilder`: Tray icon now shows the app name on hover on all platforms.
- **Added `MacosLauncher` comment**: `MacosLauncher::AppleScript` is a macOS-specific enum variant — clarified in code that it is ignored on Windows/Linux.
- **Fixed `check_updates` tray handler**: Previously always force-showed the window. Now only shows the window if it is currently hidden — leaves a focused window undisturbed when triggering a check from the tray.

#### ⚛️ React / TypeScript

- **Added `src/lib/tauri.ts`**: Single shared `isTauri` constant evaluated once at module load. Eliminates copy-paste detection logic across `App.tsx` and `UpdateChecker.tsx`.
- **Removed redundant `import React`** in `main.tsx`: React 19 JSX transform handles element creation without it.
- **`App.tsx` parallel init**: Combined two sequential `invoke()` calls at mount into `Promise.all()` — both preferences load simultaneously, reducing mount latency.
- **`useCallback` in `App.tsx`**: Both toggle handlers wrapped in `useCallback` with stable empty dep arrays (state setters and `isTauri` are always stable).
- **Removed dead `showPortableDialog` state in `UpdateChecker.tsx`**: State was declared but `setShowPortableDialog(true)` was never called — the modal JSX was completely unreachable dead code.
- **Fixed `useEffect` dep array in `UpdateChecker.tsx`**: `[isTauri]` → `[]` — `isTauri` is a module-level constant, not reactive state.
- **Replaced `downloadedBytesRef` / `contentLengthRef`** with closure locals inside `downloadAndInstall` — refs were redundant intermediaries for values only needed within a single async call.
- **Fixed stale closure bug** in `UpdateChecker.tsx`: `checkForUpdates` previously listed `isChecking` and `isInstalling` in its `useCallback` deps, causing the tray event listener (registered once at mount) to always call a stale version. Fix: introduced `isCheckingRef` and `isInstallingRef` as concurrency guards, making `checkForUpdates` truly stable with dep array `[]`.
- **Removed `isManualCheckRef`**: Redundant — the `isManual` parameter is already threaded through synchronously within the same call stack.
- **Fixed `React.FC` type reference** in `UpdateChecker.tsx`: `React` was not imported — replaced with `import type { FC } from "react"` and `FC<UpdateCheckerProps>`.
- **Removed dead `ExternalLink` and `X` lucide imports**: Portable dialog was removed but its icon imports remained — would have caused a TypeScript error with `noUnusedLocals: true`.
- **Wrapped `installUpdate` in `useCallback`**: No longer recreated on every render.
- **Removed `updateStatus` alias const**: Inlined `onStatusChange?.()` directly at every call site.
- **All `catch` clauses**: Changed from `error: any` to `error: unknown` with `instanceof Error` narrowing throughout.

#### 🎨 CSS

- **Removed dead `.command-pill` class**: Defined but never referenced in any TSX file.
- **Added `.footer-status` class**: Replaced an inline `style={{ display: "flex", alignItems: "center", gap: "6px" }}` on the footer div.
- **Scoped `transition: all`** → specific properties (`background-color`, `color`, `border-color`, `transform`, etc.) — overly broad transitions triggered repaints on every property change including layout properties.
- **Fixed height units**: `#root` now uses `height: 100dvh` (dynamic viewport height).
- **Removed dead modal CSS block** (~83 lines): `.modal-overlay`, `.modal-content`, `.modal-header`, `.btn-close-modal`, `.modal-actions`, `.btn-secondary`, `.btn-primary` — all orphaned after the portable dialog was removed.
- **Removed `cursor: pointer` from `.tab-btn`**: The single tab is a static non-interactive decoration (now a `<div>`, not a `<button>`).
- **Added `-moz-osx-font-smoothing: grayscale`** alongside `-webkit-font-smoothing: antialiased`.

#### ⚙️ Config & Tooling

- **`visible: true`** in `tauri.conf.json`: App window opens on launch.
- **`noUnusedLocals: true` / `noUnusedParameters: true`** in `tsconfig.json`: Were silently `false`, defeating the purpose of `strict: true`.
- **Added `tsconfig.scripts.json`**: Separate TypeScript compilation context for `scripts/` using `ES2022` lib without DOM types, preventing Node.js/DOM type collisions.
- **Removed stale `/vite.svg` favicon** from `index.html`.
- **Removed `async`** from `defineConfig(() => ...)` in `vite.config.ts` — no `await` in body, was misleading noise.
- **Added `build.target: ['chrome105']`** in `vite.config.ts`: Matches WebView2's Chromium baseline on Windows, preventing unnecessary transpilation of ES features already natively supported.
- **Fixed `repomix:arch` script**: `"bun run scripts/generate-arch.ts"` → `"bun scripts/generate-arch.ts"` (direct execution, removes extra shell spawn).
- **Added `.env` patterns to `.gitignore`**: Prevents accidental secret commits.
- **Removed `@tauri-apps/plugin-store`** from `package.json` dependencies (matching removal from Rust side).

---

## [0.3.0] - 2026-07-30

### Smart Sub-Dependency Pipeline & Cargo 2024 Edition

#### 🦀 Cargo Rust 2024 Edition Upgrade

- Upgraded `src-tauri/Cargo.toml` package edition to `2024` (Rust 2024 Edition).
- Validated Rust 2024 compilation (`cargo check`).

#### 🔄 Dual-Ecosystem & Transitive Sub-Dependency Auditor (`scripts/update-deps.ts`)

- **Parallel NPM & Crates.io Registry Lookup**: Fetches `@latest` tags in ~500ms via parallel HTTP queries.
- **Smart Skip Optimization**: Skips calling package managers for packages already up-to-date.
- **Transitive Sub-Dependency Upgrade**: Executes `bun update --latest` and `cargo update` to force-upgrade all 520+ direct & transitive sub-dependencies across NPM and Crates.io.
- **Inventory Audit & Diff Reporting**: Parses `src-tauri/Cargo.lock` (232 sub-crates) and `node_modules` (264 sub-packages) before and after lockfile refresh, logging sub-dependency version changes in a dedicated summary table.

#### 🧹 Build Cleanup Script (`bun run clean`)

- Added `"clean": "cargo clean --manifest-path src-tauri/Cargo.toml"` script to `package.json` to purge release & debug build artifacts from `src-tauri/target/`.

---

## [0.2.0] - 2026-07-30

### Handy-Inspired GitHub Auto-Update System

#### 📦 Tauri 2 Plugin Integration

- Added `tauri-plugin-updater` (`^2.10`) and `tauri-plugin-process` (`^2.3`) to Rust backend dependencies.
- Added `@tauri-apps/plugin-updater` (`^2.10.1`) and `@tauri-apps/plugin-process` (`^2.3.1`) to frontend packages.

#### 🖥️ System Tray & Frontend Updates (`UpdateChecker.tsx`)

- Added `"Check for Updates..."` item to system tray context menu in `lib.rs` that emits `"check-for-updates"` event to webview.
- Implemented `UpdateChecker` React component supporting `check()`, real-time `downloadAndInstall()` progress percentage streaming, and seamless app `relaunch()`.
- Added up-to-date indicators, progress bar, and error handling.

#### 📖 Documentation & CI/CD Pipeline

- Created [`AUTO-UPDATE.md`](AUTO-UPDATE.md) detailing GitHub Releases `latest.json` feed format, Minisign code signing keys, and GitHub Actions workflow template (`.github/workflows/release.yml`).

---

## [0.1.0] - 2026-07-30

### Initial Release

#### 🚀 Absolute @latest Tech Stack

- **TypeScript 7**: Configured with `typescript@7.0.2` and strict compiler resolution.
- **Vite 8**: Integrated `vite@8.2.0` and `@vitejs/plugin-react@6.0.5` for ultra-fast dev HMR.
- **React 19**: Integrated `react@19.2.8` and `react-dom@19.2.8`.
- **Tauri 2**: `@tauri-apps/api@2.11.1`, `@tauri-apps/cli@2.11.4`, `@tauri-apps/plugin-autostart@2.5.1`.

#### 🖥️ Desktop Container & Native Backend (Tauri v2 + Rust)

- **Taskbar System Tray Icon**: Left-click toggles GUI, right-click shows native context menu.
- **Graceful Win32 Teardown**: Quit handler sets `is_quitting = true` and calls `window.close()` for clean WebView2 class unregistration.
- **Window Close Interception**: `WindowEvent::CloseRequested` hides to tray when minimize-to-tray is enabled.

#### ⚙️ Frontend & GUI (React 19 + TypeScript + Bun)

- **1-Tab Preferences GUI** (`src/App.tsx`) with two preference toggles:
  1. **Start at OS Launch** (via `@tauri-apps/plugin-autostart`, default `OFF`).
  2. **Minimize to Taskbar on Close** (IPC state, default `ON`).
- **100% AMOLED Deep Black Design System** (`src/index.css`): `#000000` background, glassmorphic cards, neon cyan accents, smooth toggle switches.
