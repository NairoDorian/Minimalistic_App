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

### 3. Start Live Development Mode

Launch both the Vite frontend server and Tauri 2 Rust application in live hot-reload development mode:

```bash
bun run tauri dev
```

- **Left-Click Tray Icon**: Toggles GUI window visibility.
- **Right-Click Tray Icon**: Surfaces context menu (`Open / Hide GUI`, `Check for Updates...`, `Quit`).
- **Close Window (X)**: Minimizes to system tray when configured in Preferences (default: quits application).

### 4. Frontend-Only Development (Browser Preview)

To iterate purely on React 19 UI components and CSS styling in the web browser:

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

### Linux: `webkit2gtk-4.0` vs `webkit2gtk-4.1`

Tauri 2 defaults to `webkit2gtk-4.1` (built against libsoup3). If you receive missing package errors on older Ubuntu versions (e.g. 20.04), install `libwebkit2gtk-4.0-dev` or upgrade to Ubuntu 22.04 LTS+.

### macOS: App Translocation / Gatekeeper Warnings

During local production testing on macOS, unsigned binaries may trigger a Gatekeeper warning:

```bash
xattr -cr /path/to/Minimalistic\ App.app
```

For production distribution, set up Apple Developer certificates and notary credentials in `.github/workflows/release.yml`.
