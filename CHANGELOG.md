# Changelog

All notable changes to the **Minimalistic App** project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
