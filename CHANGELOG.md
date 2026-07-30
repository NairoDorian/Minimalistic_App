# Changelog

All notable changes to the **Minimalistic App** project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Added up-to-date indicators, progress bar, error handling, and portable app manual download dialog fallback.

#### 📖 Documentation & CI/CD Pipeline
- Created [`AUTO-UPDATE.md`](AUTO-UPDATE.md) detailing GitHub Releases `latest.json` feed format, Minisign code signing keys, and GitHub Actions workflow template (`.github/workflows/release.yml`).

---

## [0.1.0] - 2026-07-30

### Initial Release Highlights

#### 🚀 Absolute @latest Tech Stack
- **TypeScript 7**: Configured with `typescript@7.0.2` and strict compiler resolution.
- **Vite 8**: Integrated `vite@8.2.0` and `@vitejs/plugin-react@6.0.5` for ultra-fast dev HMR.
- **React 19**: Integrated `react@19.2.8` and `react-dom@19.2.8`.
- **Tauri 2**: Updated `@tauri-apps/api@2.11.1`, `@tauri-apps/cli@2.11.4`, `@tauri-apps/plugin-autostart@2.5.1`, and `@tauri-apps/plugin-store@2.4.4`.

#### 🖥️ Desktop Container & Native Backend (Tauri v2 + Rust)
- **Taskbar System Tray Icon**:
  - Implemented mouse event routing for system tray interactions.
  - **Left-Click**: Toggles showing/hiding the main GUI window.
  - **Right-Click**: Displays native context menu with **Open / Hide GUI** and **Quit**.
- **Graceful Win32 Teardown**:
  - Configured tray Quit handler to set `is_quitting = true` and invoke `window.close()`, enabling WebView2 to unregister window classes (`Chrome_WidgetWin_0`) cleanly without log errors.
- **Window Close Interception**:
  - Configured `WindowEvent::CloseRequested` listener in `src-tauri/src/lib.rs` to hide the window into the tray when minimize-to-tray is enabled.

#### ⚙️ Frontend & GUI (React 19 + TypeScript + Bun)
- **1-Tab Preferences GUI**:
  - Created modern 1-tab menu (`src/App.tsx`) with two preferences toggles:
    1. **Start at OS Launch** (controlled via `@tauri-apps/plugin-autostart`, default `OFF`).
    2. **Minimize to Taskbar on Close** (IPC state persisted, default `ON`).
- **100% AMOLED Deep Black Visual Design System**:
  - Created custom CSS design system (`src/index.css`) featuring a `#000000` pitch black background, translucent glassmorphic card overlays (`backdrop-filter: blur(20px)`), neon cyan (`#00f2fe`) accent glows, and smooth toggle switches.
