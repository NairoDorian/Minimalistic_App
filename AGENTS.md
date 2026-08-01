# Development Procedure & Workflow Guidelines (AGENTS.md)

This repository contains a cross-platform minimalistic desktop application template powered by **Tauri 2**, **Bun.js**, **React 19**, **TypeScript 7**, and **Cargo (Rust 2024 Edition)**.

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

Follow this 7-step process when developing, modifying, or testing this repository:

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
To run the automated **End-to-End Dual-Ecosystem & Sub-Dependency Upgrade Pipeline**:
```bash
bun run update-deps
```

### Step 3: Development & Primary Testing
Run the app in live development mode using the ultimate test command:
```bash
bun run tauri dev
```
- **Left-Click Tray Icon**: Toggles GUI window show/hide.
- **Right-Click Tray Icon**: Opens context menu with **Open / Hide GUI**, **Check for Updates...**, and **Quit**.
- **Close Button (X)**: Minimizes to taskbar tray when enabled in preferences.

### Step 4: Version Sync Before Committing
Before any commit, synchronize the single global application version (`APP_VERSION` in `scripts/version.ts`) across all mirrors:
```bash
bun run before-commit
```
- `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` are auto-synced mirrors — NEVER hardcode or edit the version there; only `scripts/version.ts` (or `bun run before-commit --bump <major|minor|patch>`) may change it.
- Use `bun run before-commit --check` for read-only validation (exit 1 on drift) in CI or pre-commit hooks.

### Step 5: Cleaning Build Target Artifacts (Optional)
To purge `src-tauri/target/` build directories completely:
```bash
bun run clean
```

### Step 6: Architecture Maintenance
Whenever files are added, modified, or removed, run the architecture map generator:
```bash
bun run arch
```
- Ensures [`ARCHITECTURE.md`](ARCHITECTURE.md) contains the up-to-date directory tree and file inventory table without code dumps.

### Step 7: Production Build Validation
Validate production compilation and native bundle generation:
```bash
bun run build
```

---

## 📦 Release Procedure (Version Bump → Commit → Push) — EXACT ORDER

Follow these steps **in this order** whenever a version bump / release is requested. Do NOT skip or reorder them.

### 1. Bump the Version (single command, propagates everywhere)
```bash
bun run before-commit --bump <major|minor|patch>
```
- Updates `scripts/version.ts` (the **only** place the version is defined) and auto-syncs the mirrors: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and refreshes the `src-tauri/Cargo.lock` root crate entry via `cargo update`.
- NEVER hand-edit the version in any mirror file — the script owns them.

#### Choosing `major`, `minor`, or `patch` (SemVer semantics)

| Bump | Example | Use when | Result |
| :--- | :--- | :--- | :--- |
| `patch` | `0.8.1 → 0.8.2` | Backward-compatible **bug fixes**, corrections, and polish — no new behavior. The safest and most common bump. | patch digit `+1` |
| `minor` | `0.8.1 → 0.9.0` | New **backward-compatible features** or additions (new toggles, IPC commands, views). | minor `+1`, patch → `0` |
| `major` | `0.8.1 → 1.0.0` | **Breaking changes** — incompatible config/behavior/IPC changes, removals, renames, new runtime requirements. | major `+1`, minor → `0`, patch → `0` |

> [!NOTE]
> SemVer nuance: while below `1.0.0` (0.x), *anything* may be considered breaking. The template convention: **patch = fixes, minor = features, major = deliberate breaking overhaul**. When the user does not specify, ask which level they want.

### 2. Update `CHANGELOG.md` (top of file)
Add the new release entry with the exact version and today's date:
```markdown
## [X.Y.Z] - YYYY-MM-DD

### <Round / Release Title>

#### ⚛️ <Category>
- **Change**: Description.
```
- The `## [X.Y.Z]` header **must** match the bumped version — `before-commit --check` warns when it's missing.
- Do this BEFORE regenerating the architecture map, so metrics include the edit.

### 3. Update Other Docs ONLY if Version-Dependent
`README.md`, `AUTO-UPDATE.md`, and `AGENTS.md` usually need no changes for a patch bump. Only edit them when their content actually references version-dependent facts (e.g. tech-stack tables, new scripts, changed workflow steps). Do not churn docs for the sake of it.

### 4. Regenerate the Architecture Map
```bash
bun run arch
```
- `ARCHITECTURE.md` embeds per-file metrics (sizes, lines, tokens) — the changelog edit and any new files change these, so regeneration MUST happen after steps 1–3.

### 5. Validate Everything (order: check, then typecheck)
```bash
bun run before-commit --check   # all mirrors at X.Y.Z — exit 1 on drift
bun run typecheck               # bun x tsc -b
```
- If `--check` fails, run `bun run before-commit` (plain sync) or re-run `--bump` and fix the drift before committing.

### 6. Commit (repository message style)
```bash
rtk git add <files>
rtk git commit -m "feat(vX.Y.Z): <short summary> — <key changes, comma separated>"
```
- Style precedent: `feat(v0.8.0): deep audit round 5 — single-instance guard, ToggleSwitch extraction, ...`
- Only commit when explicitly asked. Inspect `rtk git status` / `rtk git diff` first; never stage secrets or build artifacts (they are gitignored).

### 7. Push
```bash
rtk git push origin main
```
- If the commit was already pushed and you must amend it (`rtk git commit --amend`), push with `--force-with-lease` (never bare `--force`).

> [!IMPORTANT]
> **Why this order**: bump first (mirrors must match the new version before anything else reads them), then changelog (so `--check` can verify the header), then `arch` (so metrics include the changelog), then validate, commit, push. Reversing any two steps breaks the invariants the scripts enforce.

---

### `bun run before-commit` Reference — Every Mode, Explained

| Command | What it does | Writes? |
| :--- | :--- | :--- |
| `bun run before-commit` | **Sync mode (default).** Reads `APP_VERSION` from `scripts/version.ts` and propagates it into `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`; refreshes the `src-tauri/Cargo.lock` root crate entry via `cargo update` when stale. Prints a per-mirror report (`✅ in sync` / `🔧 fixed`). | Yes |
| `bun run before-commit --check` | **Validation mode.** Compares every mirror against `APP_VERSION` **without writing**; exits `1` on any drift (the report names the file and shows expected vs. actual). Safe for CI and pre-commit hooks. | No |
| `bun run before-commit --bump patch` | Increments the patch digit in `scripts/version.ts` (`0.8.1 → 0.8.2`), then runs the sync. | Yes (incl. `version.ts`) |
| `bun run before-commit --bump minor` | Increments the minor digit and zeroes patch (`0.8.1 → 0.9.0`), then runs the sync. | Yes (incl. `version.ts`) |
| `bun run before-commit --bump major` | Increments the major digit and zeroes minor + patch (`0.8.1 → 1.0.0`), then runs the sync. | Yes (incl. `version.ts`) |
| `bun run before-commit --install-hook` | Installs `.git/hooks/pre-commit`, which runs `--check` before every commit and blocks drifted commits. Refuses to overwrite an existing hook (error explains how to chain manually). Remove with `rm .git/hooks/pre-commit`. | Yes (hook file) |
| `bun run before-commit --help` | Prints the usage summary and exits `0`. | No |

**Behavioral details:**
- **Changelog advisory**: after any bump, if `CHANGELOG.md` has no `## [<new version>]` header yet, the script prints a non-blocking `⚠️` reminder (step 2 of this procedure resolves it).
- **Exit codes**: `0` = all mirrors in sync / success; `1` = drift (`--check`), invalid usage, missing mirror files, or non-git repo (`--install-hook`).
- **Rejected combinations** (exit `1` with a descriptive message): `--bump` without a part, an unknown bump part (`--bump bogus`), and `--check --bump` together.
- **Cargo.lock refresh**: only runs `cargo update` when the root crate entry is stale; when cargo is unavailable it warns and suggests `cargo check` (the lock regenerates on the next cargo invocation anyway).

---

## 💡 Best Practices & Coding Standards

1. **Package Management Rules**:
   - To add packages: `bun add <package>` (or `bun add -d <package>` for devDependencies).
   - To execute scripts: `bun run <script-name>`.
   - Never generate or commit `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`.

2. **System Tray & Window Lifecycle Patterns**:
   - **Single-Instance Guard**: `tauri-plugin-single-instance` is registered first in the builder; launching the app a second time focuses the existing window instead of spawning a duplicate tray icon.
   - **Graceful Win32 Teardown**: Set `is_quitting = true` in `AppState` and call `window.close()` on the main window. This allows WebView2 to unregister window classes (`Chrome_WidgetWin_0`) cleanly through the Win32 message loop without throwing log errors.
   - **IPC State Syncing**: Use `get_minimize_to_tray` and `set_minimize_to_tray` IPC commands for preferences (persisted on disk to `$APP_DATA_DIR/<AppName>/settings.json`), and `@tauri-apps/plugin-autostart` for OS launch settings.

3. **UI Theme & Aesthetic Standards**:
   - **Background**: 100% AMOLED Deep Black (`#000000`).
   - **Glassmorphism**: Translucent frosted cards (`backdrop-filter: blur(20px)`), `rgba(255, 255, 255, 0.08)` borders, and neon cyan (`#00f2fe`) accent glows.
   - **Typography**: Clean, sans-serif typography (`Inter`).

4. **Documentation Rules**:
   - Maintain [`README.md`](README.md), [`CHANGELOG.md`](CHANGELOG.md), [`AUTO-UPDATE.md`](AUTO-UPDATE.md), and [`AGENTS.md`](AGENTS.md).
   - Keep inline code comments detailed and informative.
