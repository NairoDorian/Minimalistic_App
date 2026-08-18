# Minimalistic App Auto-Update System 🚀

This document details the **GitHub Releases Auto-Update System** implemented in this template, taking direct architectural and technical inspiration from the [**Handy**](https://github.com/cjpais/Handy) application.

---

## 📌 Architecture Overview

The auto-update workflow allows published releases on GitHub to be detected, downloaded, cryptographically verified, installed, and launched automatically without manual user intervention.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Tray as System Tray Menu
    participant UI as React Frontend (UpdateChecker)
    participant Tauri as Tauri 2 Rust Backend
    participant GH as GitHub Releases API

    User->>Tray: Click "Check for Updates..."
    Tray->>UI: Emit event ("check-for-updates")
    UI->>GH: HTTP GET latest/download/latest.json
    GH-->>UI: Return release metadata & signatures
    alt New Version Available
        UI->>User: Display "Install vX.Y.Z"
        User->>UI: Click "Install"
        UI->>GH: Stream binary download (Progress events)
        UI->>Tauri: Download & Verify Minisign signature
        Tauri->>Tauri: Execute silent installer / binary replace
        Tauri->>UI: Trigger relaunch()
        UI->>User: Restart app into new version
    else Up to Date
        UI->>User: Display "App is up to date" banner
    end
```

---

## 🛠️ Key Components & Responsibilities

### 1. Tauri 2 Config (`src-tauri/tauri.conf.json`)

The updater plugin is configured under `bundle` and `plugins.updater`:

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "YOUR_MINISIGN_PUBLIC_KEY_HERE",
      "endpoints": [
        "https://github.com/your-username/minimalistic-app/releases/latest/download/latest.json"
      ]
    }
  }
}
```

- **`createUpdaterArtifacts: true`**: Instructs `bun run tauri build` to automatically sign generated installers (`.nsis`, `.msi`, `.dmg`, `.AppImage`) and output a matching `latest.json` file.
- **`endpoints`**: Specifies the direct download URL for `latest.json` on GitHub Releases.
- **`pubkey`**: ⚠️ The template ships a **placeholder** key. Replace it with your own Minisign public key (see [Cryptographic Code Signing](#-cryptographic-code-signing-minisign)) — otherwise signature verification will fail against your signed artifacts.

### 2. Rust Backend Integration (`src-tauri/src/lib.rs`)

1. **Plugin Initialization** (in the builder chain):

   ```rust
   .plugin(tauri_plugin_process::init())
   .plugin(tauri_plugin_updater::Builder::new().build())
   ```

2. **System Tray Integration**:
   A context menu item `"check_updates"` is registered on the tray icon. Clicking it surfaces the window **only if hidden** and emits `"check-for-updates"` to React:

   ```rust
   "check_updates" => {
       show_window_if_hidden(app);
       let _ = app.emit("check-for-updates", ());
   }
   ```

3. **Capabilities** (`src-tauri/capabilities/default.json`): the webview needs the `updater:default` and `process:default` permissions (both already granted in the template) to call `check()` / `downloadAndInstall()` / `relaunch()`.

### 3. React Frontend Component (`src/components/UpdateChecker.tsx`)

Inspired by Handy's `UpdateChecker` design:

- **`check()`**: Queries the configured `latest.json` endpoint to compare version strings.
- **`downloadAndInstall(onProgress)`**: Streams binary download chunks, emitting `Started`, `Progress`, and `Finished` events to calculate dynamic download percentages.
- **`relaunch()`**: Automatically terminates the running app process and launches the newly updated application binary.
- **Dual-variant rule**: only the card instance (Preferences tab) auto-checks on mount and listens for tray events; the footer variant passes `autoCheckOnMount={false} listenForEvents={false}` to prevent duplicate network requests.

---

## 🔐 Cryptographic Code Signing (Minisign)

Tauri 2 requires update payloads to be signed using Minisign key pairs to prevent binary tampering.

### Generating Keys

Run the following command in your terminal using Bun:

```bash
bun tauri signer generate
```

This command produces:

1. **Public Key**: Placed inside `tauri.conf.json` under `plugins.updater.pubkey`.
2. **Private Key**: Stored securely as an environment variable (`TAURI_SIGNING_PRIVATE_KEY`) in GitHub Repository Secrets.

---

## 📄 `latest.json` Feed Schema

When a release build completes, Tauri generates a `latest.json` metadata feed formatted like this:

```json
{
  "version": "0.9.0",
  "notes": "Feature updates and stability improvements.",
  "pub_date": "2026-08-01T18:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHNpZ25hdHVyZQ...",
      "url": "https://github.com/your-username/minimalistic-app/releases/download/v0.9.0/minimalistic-app_0.9.0_x64-setup.exe"
    },
    "darwin-aarch64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHNpZ25hdHVyZQ...",
      "url": "https://github.com/your-username/minimalistic-app/releases/download/v0.9.0/minimalistic-app_0.9.0_aarch64.app.tar.gz"
    }
  }
}
```

The `url` fields point at the exact installers uploaded to the GitHub Release; `signature` is the Minisign signature of each binary. The updater plugin verifies every download against these before installing.

---

## 🤖 Continuous Integration & GitHub Actions Workflow

Below is the production-ready `.github/workflows/release.yml` workflow that automates building signed installers and publishing updates to GitHub Releases. It is **committed to the repo** and runs on every `v*` tag push (`workflow_dispatch` also available) — no separate commit required. When you fork this template, customize the `TAURI_SIGNING_PRIVATE_KEY` secrets and repo links as described in the steps below.

```yaml
name: 'Release Build & Auto-Update Dispatch'

on:
  push:
    tags:
      - 'v*'

jobs:
  publish-tauri:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: 'windows-latest'
            args: ''
          - platform: 'macos-latest'
            args: ''
          - platform: 'ubuntu-24.04'
            args: ''

    runs-on: ${{ matrix.platform }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Setup Rust toolchain
        uses: dtolnay/rust-toolchain@stable

      - name: Install dependencies (Linux only)
        if: matrix.platform == 'ubuntu-24.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev patchelf

      - name: Install Node/Bun dependencies
        run: bun install

      - name: Build and Publish Tauri Application
        uses: tauri-apps/tauri-action@v0.5
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: v__VERSION__
          releaseName: 'Minimalistic App v__VERSION__'
          releaseBody: 'See release commit logs for details.'
          releaseDraft: false
          prerelease: false
          args: ${{ matrix.args }}
```

> [!TIP]
> `tagName: v__VERSION__` is auto-resolved from `tauri.conf.json` — keep version mirrors in sync (`bun run before-commit --check`) so the tag matches the app version.

---

## 🚀 Your First Release — Step-by-Step

1. **Update GitHub Repository Links**:
   Replace `your-username/minimalistic-app` in `src-tauri/tauri.conf.json` (updater `endpoints`) with your real GitHub owner and repository name.
2. **Generate Minisign Keys**:
   Execute `bun tauri signer generate` and paste the **public key** into `tauri.conf.json` under `plugins.updater.pubkey`.
3. **Set Repository Secrets**:
   Add `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to your GitHub Repository Secrets (`Settings > Secrets & Variables > Actions`).
4. **Configure the Release Workflow**:
   The committed `.github/workflows/release.yml` triggers on `v*` tag pushes (or manually via `workflow_dispatch`). Add your signing secrets (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) to **Settings → Secrets & Variables → Actions** and point `endpoints`/`pubkey` at your repo.
5. **Bump & Validate** (exact order — see `AGENTS.md`):
   ```bash
   bun run before-commit --bump <major|minor|patch>
   bun run before-commit --check
   bun run typecheck
   ```
6. **Publish the Release**:
   Push a version tag matching `tauri.conf.json` (e.g. `git tag v0.9.0 && git push origin v0.9.0`) to trigger the GitHub Actions release pipeline.
7. **Verify the Feed**:
   After the workflow finishes, open `https://github.com/<owner>/<repo>/releases/latest/download/latest.json` in a browser — it should return the versioned JSON above. Then click "Check for Updates..." in the running app.

---

## 🧰 Troubleshooting

| Symptom                                                        | Cause & Fix                                                                                                                                                                                            |
| :------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"Update endpoint not found (GitHub release pending)"**       | No release exists yet, or `endpoints` still points at `your-username/minimalistic-app`. Publish a `v*` tag via the release workflow, then retry.                                                       |
| **"Unable to connect to update server"**                       | Network offline, GitHub unreachable, or the repo is private (releases must be public for anonymous downloads).                                                                                         |
| **Signature verification fails**                               | `plugins.updater.pubkey` does not match the private key used to sign the artifacts. Regenerate keys and re-publish — keys are one-way matched.                                                         |
| **`latest.json` 404s after a successful release**              | The workflow produced it but `createUpdaterArtifacts: true` is missing, or the artifact names don't match the URL patterns in the feed. Check the workflow run logs for the `latest.json` upload step. |
| **Release job fails with missing `TAURI_SIGNING_PRIVATE_KEY`** | The repository secrets were not set (Step 3). Without them `tauri-action` cannot sign artifacts.                                                                                                       |
| **Update downloads but relaunch does nothing**                 | The `process:default` capability is missing — check `src-tauri/capabilities/default.json`.                                                                                                             |
| **App updates during dev but not in release build**            | `bun run tauri dev` uses the dev URL; update checks are fully functional in dev, but ensure the installed release build (not the dev binary) is the one checking.                                      |
| **CSP blocks the update check**                                | The CSP in `tauri.conf.json` must include `https://github.com` and `https://api.github.com` in `connect-src` (the template already does).                                                              |
