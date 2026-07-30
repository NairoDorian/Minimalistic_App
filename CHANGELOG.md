# Changelog

All notable changes to the **Minimalistic App** project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

#### 🔄 Automated Update & Verification Pipeline
- **`scripts/update-deps.ts`**:
  - Created end-to-end update & build validation script runnable via `bun run update-deps`.
  - Upgrades npm packages dynamically to `@latest`, updates Cargo crates, builds Vite frontend bundle, verifies Cargo compilation (`cargo check`), and updates `ARCHITECTURE.md`.
- **`scripts/generate-arch.ts`**:
  - Repomix script executed via `bun run repomix:arch` to update [`ARCHITECTURE.md`](ARCHITECTURE.md) with full directory tree and 1-line file descriptions without code dumps.
- **`scripts/create-icons.ts`**:
  - Built icon generator using `node:zlib` to output 100% valid RGBA PNGs and Windows ICO binary headers for the Rust resource compiler (`RC.EXE`).
