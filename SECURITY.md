# Security Policy & Architecture

This document outlines the security model, data protection guarantees, and vulnerability reporting procedures for **Minimalistic App**.

---

## 🛡️ Security Architecture

### 1. Tauri v2 Capability & Permission Model

Tauri v2 enforces a strict capability-based security model. Webview access to native host functionality is locked down by default:

- **Explicit Capabilities** (`src-tauri/capabilities/default.json`): The frontend webview is granted only the permissions strictly required to function:
  - `autostart:default`: Windows/macOS/Linux system startup toggle.
  - `process:default`: Safe application relaunching during updates.
  - `updater:default`: Checking and applying cryptographically signed GitHub releases.
  - `core:tray:default`: Tray icon context menu and click routing.
- **IPC Command Whitelisting**: Frontend JavaScript cannot execute arbitrary system commands or filesystem operations; it communicates exclusively through registered Rust IPC handlers (`get_minimize_to_tray`, `set_minimize_to_tray`, `get_app_info`).

### 2. Atomic Disk Persistence & Crash Resistance

Configuration files (`settings.json`) are stored within the OS-managed app config directory:

- **Atomic Write-and-Rename**: The application never overwrites existing configuration files in place. It writes to an adjacent temporary file (`settings.json.tmp`) and atomically renames it.
- **Power Loss & Crash Safety**: Sudden power loss or process termination will never leave a corrupt, truncated, or zero-byte configuration file on disk.

### 3. Auto-Update Cryptographic Verification (Minisign)

All auto-update binaries are verified using **Minisign public-key cryptography** before execution:

- The update manifest (`latest.json`) and application archives (`.msi`, `.exe`, `.dmg`, `.AppImage`) are signed with the developer's private key.
- The Tauri runtime checks the signature against the embedded public key in `tauri.conf.json`. Unsigned, corrupted, or tampered downloads are rejected before installation.

### 4. Sensitive Data & Credential Storage Guidelines

For features requiring sensitive credentials (e.g. API tokens, encryption keys):

- **Never Store in Plaintext**: Plaintext storage in configuration JSON is strictly prohibited for secrets.
- **Recommended Native Vaults**:
  - **Windows**: Use Windows Data Protection API (**DPAPI**) (`CryptProtectData` / `CryptUnprotectData`).
  - **macOS**: Use Apple **Keychain Services**.
  - **Linux**: Use **Secret Service API** / Freedesktop Keyring (`libsecret`).

---

## 🔒 Content Security Policy (CSP)

The webview enforces strict Content Security Policies in production:

- No remote script execution (`script-src 'self'`).
- Restricted stylesheet and asset loading.
- Inline styles are restricted to designated theme variables.

---

## 🚨 Reporting a Vulnerability

We take the security of Minimalistic App seriously. If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public GitHub issue.**
2. Send an email to the project maintainers with:
   - Detailed description of the vulnerability and attack vector.
   - Proof of Concept (PoC) or reproduction steps.
   - Affected platforms and versions.
3. We will acknowledge receipt within 48 hours and provide a remediation timeline.
4. Security advisories will be published alongside patched releases in [CHANGELOG.md](CHANGELOG.md).
