# Changelog

All notable changes to the **Minimalistic App** project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> [!NOTE]
> **Release flow (exact order)**: `bun run before-commit --bump <major|minor|patch>` → add this version's entry at the top of this file → `bun run arch` → `bun run before-commit --check` + `bun run typecheck` → commit & push (`feat(vX.Y.Z): ...`). Bump levels: **patch** = fixes (`0.8.1 → 0.8.2`), **minor** = backward-compatible features (`0.8.1 → 0.9.0`), **major** = breaking changes (`0.8.1 → 1.0.0`). Full walkthrough: `README.md` / `AGENTS.md`.

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

#### 📦 Dependencies & Ecosystem
- **React**: Updated exact-pinned canary build to `19.3.0-canary-beef6d60-20260813`.
- **TypeScript**: Updated compiler nightly to `7.1.0-dev.20260813.1`.
- **Vite & Tooling**: Upgraded `vite` to `^8.2.1`, `@types/node` to `26.2.0`, `lucide-react` to `^1.31.0`, and `repomix` to `^1.18.0`.
- **Transitive dependencies**: Refreshed all 788 NPM sub-packages and Cargo sub-crates to their latest stable releases.

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
- **Publisher-agnostic prerelease selection**: `--prerelease` no longer stops at the first qualifying dist-tag in a fixed order. EVERY tag is now evaluated and the best **strictly-newer** candidate wins. Ranking: highest SemVer core first; for equal cores, the **newest publish date** (packument `time` field) — this is what un-stuck react's `canary` tag (published 07-31) from the older `next` build (05-07) that sorts lexically *higher*. A lexical SemVer comparison is only the last-resort tiebreak.
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
- **`set_minimize_to_tray` memory/disk/UI consistency**: The IPC handler now persists the new value to disk *first*, then commits it to memory. Previously memory was mutated before the disk write, so a failed write left in-memory state diverged from both the UI (rolled back) and disk. A no-op early return also skips redundant disk writes when the value is unchanged. The now-unused `Clone` derive on `AppSettings` was removed.
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
