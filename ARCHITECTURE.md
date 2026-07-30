# Project Architecture Overview

This document provides a single-file summary of the **Minimalistic App** architecture, generated via Repomix integration.

> [!NOTE]
> This file contains the complete directory tree and a 1-line description of every file in the project. Full code contents are omitted to keep the architecture map concise.

---

## 1. Directory Structure

```
minimalistic-app/
├── .gitignore
├── AGENTS.md
├── ARCHITECTURE.md
├── CHANGELOG.md
├── index.html
├── package.json
├── README.md
├── repomix.config.json
├── scripts
│   ├── create-icons.ts
│   ├── generate-arch.ts
│   └── update-deps.ts
├── src
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
├── src-tauri
│   ├── build.rs
│   ├── capabilities
│   │   └── default.json
│   ├── Cargo.lock
│   ├── Cargo.toml
│   ├── gen
│   │   └── schemas
│   │       ├── acl-manifests.json
│   │       ├── capabilities.json
│   │       ├── desktop-schema.json
│   │       └── windows-schema.json
│   ├── icons
│   │   ├── 128x128.png
│   │   ├── 128x128@2x.png
│   │   ├── 32x32.png
│   │   ├── icon.icns
│   │   ├── icon.ico
│   │   └── icon.png
│   ├── src
│   │   ├── lib.rs
│   │   └── main.rs
│   └── tauri.conf.json
├── tsconfig.json
└── vite.config.ts
```

---

## 2. File Inventory & Descriptions

| File Path | Description |
| :--- | :--- |
| `.gitignore` | Source or configuration file for the application. |
| `AGENTS.md` | Guidelines and technical context for AI coding agents operating on this repository. |
| `ARCHITECTURE.md` | Generated single file architecture map listing directory structure and file descriptions. |
| `CHANGELOG.md` | Version history tracking releases and features starting with v0.1.0. |
| `index.html` | Main HTML entry point featuring Google Fonts Inter and root mount target. |
| `package.json` | Project manifest containing Bun scripts, dependencies (React 19, Tauri v2), and repomix configuration. |
| `README.md` | User manual and documentation specifying feature list and 'bun run tauri dev' command. |
| `repomix.config.json` | Repomix configuration file for generating architecture and directory metadata. |
| `scripts/create-icons.ts` | Utility script for generating default application icons for Tauri v2. |
| `scripts/generate-arch.ts` | Script utilizing Repomix logic to output ARCHITECTURE.md with directory tree and 1-line descriptions. |
| `scripts/update-deps.ts` | Source or configuration file for the application. |
| `src/App.tsx` | Single-tab settings GUI with toggles for OS launch autostart and tray minimize behavior. |
| `src/index.css` | 100% AMOLED deep black theme (#000000) with glassmorphism and glowing toggle switches. |
| `src/main.tsx` | React 19 application entry point rendering App root inside StrictMode. |
| `src-tauri/build.rs` | Rust build script initializing Tauri build environment. |
| `src-tauri/capabilities/default.json` | Tauri v2 capability definitions granting autostart, store, and tray permissions. |
| `src-tauri/Cargo.lock` | Source or configuration file for the application. |
| `src-tauri/Cargo.toml` | Cargo manifest declaring Rust dependencies: tauri v2, tauri-plugin-autostart, and serde. |
| `src-tauri/gen/schemas/acl-manifests.json` | Source or configuration file for the application. |
| `src-tauri/gen/schemas/capabilities.json` | Source or configuration file for the application. |
| `src-tauri/gen/schemas/desktop-schema.json` | Source or configuration file for the application. |
| `src-tauri/gen/schemas/windows-schema.json` | Source or configuration file for the application. |
| `src-tauri/icons/128x128.png` | Source or configuration file for the application. |
| `src-tauri/icons/128x128@2x.png` | Source or configuration file for the application. |
| `src-tauri/icons/32x32.png` | Source or configuration file for the application. |
| `src-tauri/icons/icon.icns` | Source or configuration file for the application. |
| `src-tauri/icons/icon.ico` | Source or configuration file for the application. |
| `src-tauri/icons/icon.png` | Source or configuration file for the application. |
| `src-tauri/src/lib.rs` | Core Rust backend implementing System Tray menu ('Open', 'Quit'), autostart, and window hide event intercept. |
| `src-tauri/src/main.rs` | Main Rust entry point launching the lib run loop without extra Windows console. |
| `src-tauri/tauri.conf.json` | Tauri v2 configuration defining window dimensions, security capabilities, and tray bundle. |
| `tsconfig.json` | TypeScript root configuration with strict type checking and bundler resolution. |
| `vite.config.ts` | Vite bundler configuration optimized for React 19 and Tauri v2 dev server integration. |

---

## 3. Technology Stack & Data Flow

- **Frontend Layer**: Built with **React 19** and **TypeScript**, styled using a 100% AMOLED deep black theme with glassmorphic cards.
- **Desktop Container**: Powered by **Tauri v2**, executing cross-platform GUI & native system tray integration.
- **Backend & Native Integrations**: Written in **Rust (Cargo)**, handling taskbar tray context menus ("Open", "Quit"), window close intercept (`CloseRequested`), and OS autostart via `@tauri-apps/plugin-autostart`.
- **Package Manager & CLI**: Run and tested using **Bun.js** via the single primary command:
  ```bash
  bun run tauri dev
  ```
