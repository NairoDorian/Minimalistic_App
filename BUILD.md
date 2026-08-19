# Build & Setup Guide

This guide covers how to set up the local development environment, install toolchains, and build **Minimalistic App** across Windows, macOS, and Linux.

---

## 📋 Prerequisites

### Universal Toolchains (All Platforms)

1. **[Bun Package Manager](https://bun.sh/)** (v1.2+):

   ```bash
   # Windows (PowerShell)
   powershell -c "irm bun.sh/install.ps1 | iex"

   # macOS / Linux
   curl -fsSL https://bun.sh/install | bash
   ```

   > [!CRITICAL]
   > This project strictly enforces **Bun**. Do not use `npm`, `npx`, `yarn`, or `pnpm`.

2. **[Rust Toolchain](https://rustup.rs/)** (2024 Edition / stable):
   ```bash
   # Install Rust & Cargo
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
   Verify toolchain installation:
   ```bash
   bun --version
   cargo --version
   rustc --version
   ```

---

### Platform-Specific Requirements

#### 🪟 Windows

1. **Microsoft C++ Build Tools**:
   - Install **Visual Studio 2022** (or Visual Studio Build Tools) with the **"Desktop development with C++"** workload.
   - Ensure the **Windows 10/11 SDK** and **MSVC v143 toolset** are checked.
2. **Microsoft Edge WebView2**:
   - Pre-installed on Windows 10 (1803+) and Windows 11.
   - For older systems or sandbox environments, download the [WebView2 Evergreen Bootstrapper](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
3. **CMake** (Optional, recommended for native build tools):
   ```powershell
   winget install Kitware.CMake
   ```

#### 🍎 macOS

1. **Xcode Command Line Tools**:
   ```bash
   xcode-select --install
   ```
2. **Architecture Targets**:
   - **Apple Silicon (M1/M2/M3/M4, `aarch64`)**: Supported natively.
   - **Intel Mac (`x86_64`)**: Supported natively or via cross-compilation target (`rustup target add x86_64-apple-darwin`).

#### 🐧 Linux

Install the necessary development libraries for WebKit2GTK, Ayatana AppIndicator (for system tray support), and SVG rendering:

```bash
# Debian / Ubuntu (22.04 / 24.04)
sudo apt update
sudo apt install -y \
  build-essential \
  pkg-config \
  libssl-dev \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf \
  curl

# Fedora / RHEL
sudo dnf install -y \
  gcc \
  gcc-c++ \
  openssl-devel \
  gtk3-devel \
  webkit2gtk4.1-devel \
  libappindicator-gtk3-devel \
  librsvg2-devel \
  patchelf

# Arch Linux / Manjaro
sudo pacman -S --needed \
  base-devel \
  openssl \
  gtk3 \
  webkit2gtk-4.1 \
  libappindicator-gtk3 \
  librsvg \
  patchelf
```

---

## 🚀 Setup & Development Workflow

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/minimalistic-app.git
cd minimalistic-app
```

### 2. Install Project Dependencies

```bash
bun install
```

### 3. Fetch the Local Documentation Mirrors (recommended, one-time)

The upstream docs for every layer of the stack are vendored into `.docs/`
(gitignored, ~200 MB) so architecture questions can be answered offline against
the exact versions this app runs:

```bash
bun run docs:sync     # Tauri 2 (v2), SolidJS 2 (v2-rebuild), Bun, TypeScript, TypeScript 7
bun run docs:check    # verify what is present and how fresh it is
```

Requires `git` on `PATH` and network access. Skippable — the app builds and runs
without it — but every doc-driven workflow in [`AGENTS.md`](AGENTS.md) and
[`CONTRIBUTING.md`](CONTRIBUTING.md) assumes the mirrors are present. See
[`DOCUMENTATION.md`](DOCUMENTATION.md).

### 4. Start Live Development Mode

Launch both the Vite frontend server and Tauri 2 Rust application in live hot-reload development mode:

```bash
bun run tauri dev
```

- **Left-Click Tray Icon**: Toggles GUI window visibility.
- **Right-Click Tray Icon**: Surfaces context menu (`Open / Hide GUI`, `Check for Updates...`, `Quit`).
- **Close Window (X)**: Minimizes to system tray when configured in Preferences (default: quits application).

### 5. Frontend-Only Development (Browser Preview)

To iterate purely on SolidJS 2 UI components and CSS styling in the web browser:

```bash
bun run vite
```

_Note: Native Tauri APIs (such as autostart or system tray controls) will safely fall back to web-safe mock defaults._

---

## 📦 Production Builds & Packaging

### Local Production Build

Compile optimized release binaries and native OS installers:

```bash
bun run build
```

The compiled binaries and installers will be generated under `src-tauri/target/release/bundle/`:

- **Windows**: `.msi` (WiX installer) and `.exe` (NSIS setup).
- **macOS**: `.dmg` and `.app` bundles.
- **Linux**: `.deb`, `.AppImage`, and `.rpm` packages.

### Cleaning Build Artifacts

Purge intermediate Rust build artifacts and caches (`src-tauri/target/`):

```bash
bun run clean
```

---

## 🛠️ Verification & Quality Gates

Before submitting code, run the automated pre-commit validation suite:

```bash
# 1. Check code formatting
bun run format:check

# 2. Validate TypeScript static types
bun run typecheck

# 3. Check version synchronization across mirrors
bun run before-commit --check

# 4. Full pre-commit suite (Version + Types + Vite Build + Cargo Check + Arch Map)
bun run validate
```

---

## 🔧 Troubleshooting

### Windows: 260-Character Path Limit (`MAX_PATH`)

If building on Windows fails due to deeply nested path errors:

1. Enable Long Paths in Windows:
   - Run PowerShell as Administrator:
     ```powershell
     New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
       -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
     ```
2. Enable long paths in Git:
   ```bash
   git config --system core.longpaths true
   ```

### Windows: `Access is denied. (os error 5)` on `target\debug\minimalistic-app.exe`

If `bun run tauri dev` or `cargo build` fails with:

```
error: failed to remove file `...target\debug\minimalistic-app.exe`
Caused by:
  Access is denied. (os error 5)
```

This occurs on Windows because an existing instance of `minimalistic-app.exe` is still running in the background or system tray, locking the executable file.

**Fix:** Terminate the running background instance:

```powershell
# PowerShell:
Stop-Process -Name "minimalistic-app" -Force -ErrorAction SilentlyContinue

# Or via Command Prompt / cross-platform:
taskkill /F /IM minimalistic-app.exe
```

Or run the dedicated Bun script:

```bash
bun run kill
```

### Linux: `webkit2gtk-4.0` vs `webkit2gtk-4.1`

Tauri 2 defaults to `webkit2gtk-4.1` (built against libsoup3). If you receive missing package errors on older Ubuntu versions (e.g. 20.04), install `libwebkit2gtk-4.0-dev` or upgrade to Ubuntu 22.04 LTS+.

### macOS: App Translocation / Gatekeeper Warnings

During local production testing on macOS, unsigned binaries may trigger a Gatekeeper warning:

```bash
xattr -cr /path/to/Minimalistic\ App.app
```

For production distribution, set up Apple Developer certificates and notary credentials in `.github/workflows/release.yml`.
