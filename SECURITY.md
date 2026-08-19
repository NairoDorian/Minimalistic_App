# Security Policy & Architecture

This document outlines the security model, data protection guarantees, and vulnerability reporting procedures for **Minimalistic App**.

---

## 🛡️ Security Architecture

### 1. Tauri v2 Capability & Permission Model

Tauri v2 enforces a strict capability-based security model. Webview access to native host functionality is locked down by default:

- **Explicit Capabilities** (`src-tauri/capabilities/default.json`): The frontend webview is granted only the permissions strictly required to function, scoped to the `main` window:
  - `core:default`: The Tauri core permission set (event, window, webview, path primitives).
  - `autostart:allow-enable` / `allow-disable` / `allow-is-enabled`: Windows/macOS/Linux system startup toggle. Granted as three **explicit commands** rather than the `autostart:default` set — the two are identical today, but pinning the individual commands means a future upstream widening of that plugin's default set cannot silently broaden this app's surface. This is the form the plugin's own documentation shows (`.docs/tauri-docs/src/content/docs/plugin/autostart.mdx`).
  - `updater:default`: Checking and applying cryptographically signed GitHub releases.
  - `process:default`: Safe application relaunching after an update.
  - `notification:default`: Native OS notification when an update is found while the window is hidden in the tray.

  Notably **absent**: no filesystem, shell, HTTP, or dialog plugin permissions. The
  tray is built entirely in Rust (`TrayIconBuilder` in `lib.rs`) and is never
  driven from JavaScript, so no tray permission is granted to the webview.

- **IPC Command Whitelisting**: Frontend JavaScript cannot execute arbitrary system commands or filesystem operations; it communicates exclusively through the sixteen registered Rust IPC handlers, whose type-safe wrappers are generated into `src/bindings.ts` by `tauri-specta`:

  | Command                       | Purpose                                                       |
  | :---------------------------- | :------------------------------------------------------------ |
  | `get_minimize_to_tray`        | Read the close-to-tray preference.                            |
  | `set_minimize_to_tray`        | Write the close-to-tray preference and persist it.            |
  | `get_app_settings`            | Read the full persisted `AppSettings` struct.                 |
  | `update_app_settings`         | Atomically replace and persist the full `AppSettings` struct. |
  | `reset_app_settings`          | Restore factory defaults and persist.                         |
  | `get_app_info`                | Product name, version, Tauri version, OS, and architecture.   |
  | `get_system_stats`            | Process ID and runtime telemetry.                             |
  | `open_app_data_dir`           | Open the app config directory in the native file manager.     |
  | `get_recent_logs`             | Tail the backend log file for the Dev Console.                |
  | `clear_logs`                  | Truncate the backend log file.                                |
  | `get_global_hotkeys`          | List every global hotkey action and its current binding.      |
  | `get_global_hotkey_status`    | Report whether the OS listener is running, and why not.       |
  | `validate_hotkey_spec`        | Parse-check a hotkey spec without binding it.                 |
  | `set_global_hotkey`           | Bind or clear one global hotkey and restart the listener.     |
  | `set_global_hotkeys_enabled`  | Turn the global hotkey listener on or off.                    |
  | `open_accessibility_settings` | macOS: open the Accessibility settings pane.                  |

  Every command that touches the filesystem operates only on paths the Rust side
  derives itself (`app_config_dir()` / `app_log_dir()`); no path, glob, or command
  string is ever accepted from the frontend.

- **Untrusted-File Tolerance**: the settings file on disk is user-writable, so
  it is an input like any other. A malformed value no longer discards the
  document: `src-tauri/src/settings_repair.rs` merges the stored JSON over the
  serialized defaults, identifies the exact path serde rejected via
  `serde_path_to_error`, resets that field alone, and retries under a bounded
  attempt budget. Only a file that is not valid JSON at all is quarantined to
  `.bak`. This is availability hardening rather than confidentiality: it means a
  corrupt or hand-edited file degrades one setting instead of silently resetting
  every security-relevant preference (autostart, global hotkeys) at once. Note
  that an unreadable file — a permissions or I/O error — is deliberately **not**
  quarantined, since renaming it would turn a transient failure into permanent
  data loss.

- **Input Sanitization at the Trust Boundary**: `update_app_settings` accepts a
  struct from the webview, so imported settings backups are passed through a
  strict sanitizer first (`src/lib/settingsBackup.ts`): unknown fields are dropped,
  every field is individually type-checked, the theme accent must name a known
  preset, and window geometry must be a non-negative whole number. On the Rust
  side every field additionally carries a serde default, so a truncated or older
  settings file loads rather than failing — the two layers are independent, and
  the backend does not trust the frontend's sanitizer to have run.

### 2. Global Hotkeys — a System-Wide Keyboard Hook

The global hotkey engine (`src-tauri/src/hotkeys/`) installs an **OS-level
keyboard hook**, which is inherently a sensitive capability: on every platform,
"observe global shortcuts" and "observe all keystrokes" are the same permission.
The template treats it accordingly:

- **Opt-in, off by default.** `global_hotkeys_enabled` defaults to `false`; no hook is installed until the user turns it on in Preferences.
- **No listener without bindings.** With the feature on but nothing bound, the listener is not started at all.
- **Keystrokes are never stored, logged, or transmitted.** The hook's callback compares each event against the registered hotkeys and discards it. Only the _action name_ of a matched hotkey is logged (`[hotkeys] Global hotkey fired: toggle_window`) — never a key, a character, or a modifier state.
- **No IPC exposure of the key stream.** The webview can register and query bindings; it cannot subscribe to raw key events. The only event it receives is the name of a matched action.
- **The hook is released deterministically.** Disabling the feature, rebinding, or quitting joins the dispatch thread, whose `Drop` unhooks before the call returns, so no hook outlives the process.
- **Platform permission is the user's to grant**: macOS requires an explicit Accessibility grant (the UI links straight to the settings pane); Linux requires read access to `/dev/input` (and `/dev/uinput` for blocking) via a udev `uaccess` rule — never by adding users to the `input` group, which would also apply to SSH sessions.

When forking this template, keep these properties: an app that observes the
global keyboard has to be trustworthy about what it does with what it sees.

### 3. Atomic Disk Persistence & Crash Resistance

Configuration files (`settings.json`) are stored within the OS-managed app config directory:

- **Atomic Write-and-Rename**: The application never overwrites existing configuration files in place. It writes to an adjacent temporary file (`settings.json.tmp`) and atomically renames it.
- **Power Loss & Crash Safety**: Sudden power loss or process termination will never leave a corrupt, truncated, or zero-byte configuration file on disk.

### 4. Auto-Update Cryptographic Verification (Minisign)

All auto-update binaries are verified using **Minisign public-key cryptography** before execution:

- The update manifest (`latest.json`) and application archives (`.msi`, `.exe`, `.dmg`, `.AppImage`) are signed with the developer's private key.
- The Tauri runtime checks the signature against the embedded public key in `tauri.conf.json`. Unsigned, corrupted, or tampered downloads are rejected before installation.

### 5. Sensitive Data & Credential Storage Guidelines

For features requiring sensitive credentials (e.g. API tokens, encryption keys):

- **Never Store in Plaintext**: Plaintext storage in configuration JSON is strictly prohibited for secrets.
- **Recommended Native Vaults**:
  - **Windows**: Use Windows Data Protection API (**DPAPI**) (`CryptProtectData` / `CryptUnprotectData`).
  - **macOS**: Use Apple **Keychain Services**.
  - **Linux**: Use **Secret Service API** / Freedesktop Keyring (`libsecret`).

---

## 🔒 Content Security Policy (CSP)

The webview enforces a strict Content Security Policy in production
(`app.security.csp` in `src-tauri/tauri.conf.json`):

- **No remote script execution** — `script-src 'self'`; Tauri appends its own
  nonces and hashes for bundled assets at compile time.
- **No outbound webview network access** — `connect-src` allows only `'self'`
  and the Tauri IPC channels (`ipc:`, `asset:`, `http://ipc.localhost`).
  The updater's HTTPS traffic to GitHub Releases is performed **by the Rust
  process**, not the webview, so no GitHub origin appears here. (It used to:
  `https://github.com` and `https://api.github.com` were allowed by an earlier
  revision even though no frontend code ever fetched them. They were removed —
  the Tauri CSP guidance is to allow only hosts the webview genuinely needs.)
- **Nothing may embed or be embedded** — `object-src`, `frame-src`,
  `frame-ancestors` and `form-action` are all `'none'`, and `base-uri 'none'`
  prevents base-tag hijacking.
- **Inline styles are permitted** (`style-src 'unsafe-inline'`) because SolidJS
  writes theme accent values as inline `style` properties; inline **scripts**
  are not.
- **One remote origin pair remains**: `https://fonts.googleapis.com`
  (stylesheet) and `https://fonts.gstatic.com` (woff2) for the Inter webfont
  loaded by `index.html`. This is the only third-party content the webview
  fetches. Self-hosting Inter under `public/fonts/` would remove both origins
  and make the app fully offline-capable — see the note in `README.md`.

---

## 📚 Verifying These Claims Against Upstream

The Tauri 2 security documentation is vendored locally so every statement above
can be checked against the primary source rather than taken on trust:

```bash
bun run docs:sync
bun run docs:find "capabilities"
```

| Claim in this document            | Upstream reference                                                 |
| :-------------------------------- | :----------------------------------------------------------------- |
| Capability & permission model     | `.docs/tauri-docs/src/content/docs/security/capabilities.mdx`      |
| What a permission actually grants | `.docs/tauri-docs/src/content/docs/security/permissions.mdx`       |
| Runtime authority / ACL           | `.docs/tauri-docs/src/content/docs/security/runtime-authority.mdx` |
| Content Security Policy           | `.docs/tauri-docs/src/content/docs/security/csp.mdx`               |
| Updater signature verification    | `.docs/tauri-docs/src/content/docs/plugin/updater.mdx`             |

See [`DOCUMENTATION.md`](DOCUMENTATION.md).

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
