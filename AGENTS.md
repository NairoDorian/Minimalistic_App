# Development Procedure & Workflow Guidelines (AGENTS.md)

This repository contains a cross-platform minimalistic desktop application template powered by **Tauri 2**, **Bun.js**, **React 19**, **TypeScript 7**, and **Cargo / Rust**.

---

## ⚡ Primary Standard: Bun & Testing Command

> [!CRITICAL]
> **1. Package Manager Standard**:
> NEVER use `npm`, `npx`, `yarn`, or `pnpm`. **ALWAYS use `bun`** for dependency management, script execution, and tooling.
>
> **2. Ultimate Testing Command**:
> The **ONLY** primary command to launch, test, and develop this application is:
> ```bash
> bun run tauri dev
> ```

---

## 📋 Standard Operating Procedure (SOP)

Follow this 5-step process when developing, modifying, or testing this repository:

### Step 1: Environment Verification
Verify that Bun and Cargo/Rust toolchains are installed:
```bash
bun --version
cargo --version
```

### Step 2: Dependency Installation & Automated @latest Upgrades
Install project dependencies using Bun:
```bash
bun install
```
To run the automated **End-to-End Dependency Upgrade & Build Validation Pipeline**:
```bash
bun run update-deps
```

### Step 3: Development & Primary Testing
Run the app in live development mode using the ultimate test command:
```bash
bun run tauri dev
```
- **Left-Click Tray Icon**: Toggles GUI window show/hide.
- **Right-Click Tray Icon**: Opens context menu with **Open / Hide GUI** and **Quit**.
- **Close Button (X)**: Minimizes to taskbar tray when enabled in preferences.

### Step 4: Architecture Maintenance (Repomix)
Whenever files are added, modified, or removed, run the architecture map generator:
```bash
bun run repomix:arch
```
- Ensures [`ARCHITECTURE.md`](ARCHITECTURE.md) contains the up-to-date directory tree and file inventory table without code dumps.

### Step 5: Production Build Validation
Validate production compilation and native bundle generation:
```bash
bun run build
```

---

## 💡 Best Practices & Coding Standards

1. **Package Management Rules**:
   - To add packages: `bun add <package>` (or `bun add -d <package>` for devDependencies).
   - To execute scripts: `bun run <script-name>`.
   - Never generate or commit `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`.

2. **System Tray & Window Lifecycle Patterns**:
   - **Graceful Win32 Teardown**: Set `is_quitting = true` in `AppState` and call `window.close()` on the main window. This allows WebView2 to unregister window classes (`Chrome_WidgetWin_0`) cleanly through the Win32 message loop without throwing log errors.
   - **IPC State Syncing**: Use `get_minimize_to_tray` and `set_minimize_to_tray` IPC commands for preferences, and `@tauri-apps/plugin-autostart` for OS launch settings.

3. **UI Theme & Aesthetic Standards**:
   - **Background**: 100% AMOLED Deep Black (`#000000`).
   - **Glassmorphism**: Translucent frosted cards (`backdrop-filter: blur(20px)`), `rgba(255, 255, 255, 0.08)` borders, and neon cyan (`#00f2fe`) accent glows.
   - **Typography**: Clean, sans-serif typography (`Inter`).

4. **Documentation Rules**:
   - Maintain [`README.md`](README.md), [`CHANGELOG.md`](CHANGELOG.md), and [`AGENTS.md`](AGENTS.md).
   - Keep inline code comments detailed and informative.
