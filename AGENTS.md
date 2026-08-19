# Development Procedure & Workflow Guidelines (AGENTS.md)

This repository contains a cross-platform minimalistic desktop application template powered by **Tauri 2**, **Bun.js**, **SolidJS 2**, **TypeScript 7**, and **Cargo (Rust 2024 Edition)**.

---

## ⚡ Primary Standard: Bun, Testing Command & Golden Rule

> [!CRITICAL]
> **1. Package Manager Standard**:
> NEVER use `npm`, `npx`, `yarn`, or `pnpm`. **ALWAYS use `bun`** for dependency management, script execution, and tooling.
>
> **2. Ultimate Testing Command**:
> The **ONLY** primary command to launch, test, and develop this application is:
>
> ```bash
> bun run tauri dev
> ```
>
> **3. Golden Rule — `rtk` Command Prefix**:
> Always prefix commands with `rtk`. If RTK has a dedicated filter, use it; otherwise it passes the command through unchanged. RTK is always safe.
>
> - This applies to **every** command, including chains: `rtk git add . && rtk git commit -m "msg" && rtk git push`.
> - `rtk bun ...` is NOT used — `rtk` is not needed in front of `bun` when running the sanctioned Bun scripts (see the command table below).
>
> | ❌ Wrong                                       | ✅ Correct                                                              |
> | :--------------------------------------------- | :---------------------------------------------------------------------- |
> | `git add . && git commit -m "msg" && git push` | `rtk git add . && rtk git commit -m "msg" && rtk git push`              |
> | `git status`                                   | `rtk git status`                                                        |
> | `bun run typecheck`                            | `bun run typecheck` (Bun scripts run directly, no `rtk` wrapper needed) |

---

## 📚 Documentation-First Standard

> [!CRITICAL]
> **The upstream documentation for every layer of this stack is vendored on disk.
> Read it before answering an architecture question — do not answer from memory
> and do not reach for a web search first.**
>
> ```bash
> bun run docs:sync                  # clone/refresh every mirror (gitignored, ~200 MB)
> bun run docs:check                 # branch, commit, freshness per mirror
> bun run docs:find "capabilities"   # search all mirrors at once
> ```
>
> | Layer                | Local mirror                         | Pinned branch |
> | :------------------- | :----------------------------------- | :------------ |
> | Tauri 2              | `.docs/tauri-docs/src/content/docs/` | `v2`          |
> | SolidJS 2            | `.docs/solid-docs/src/routes/`       | `v2-rebuild`  |
> | Bun                  | `.docs/bun-docs/content/docs/`       | `main`        |
> | TypeScript           | `.docs/typescript-website/packages/` | `v2`          |
> | TypeScript 7 changes | `.docs/typescript-go/CHANGES.md`     | `main`        |
>
> **The branch pins are load-bearing.** `solid-docs@main` documents SolidJS 1.x —
> a different runtime with `createResource`, `onMount`, `<Suspense>` and
> `<ErrorBoundary>`, none of which exist in this codebase. Tauri 1 docs describe
> an allowlist security model we do not use. TypeScript 5 tutorials assume
> defaults TypeScript 7 changed.
>
> **Cite the file you read** when a change is doc-driven, e.g. "per
> `.docs/solid-docs/src/routes/(2)concepts/(4)boundaries.mdx`, a loading boundary
> belongs around the smallest coherent region".
>
> Never edit anything under `.docs/` — it is a read-only checkout and the next
> sync hard-resets it. Adding a significant dependency means adding its docs to
> the manifest in `scripts/sync-docs.ts`.
>
> Full reading map: [`DOCUMENTATION.md`](DOCUMENTATION.md). TypeScript 7 specifics
> and this repo's compliance audit: [`TYPESCRIPT-7.md`](TYPESCRIPT-7.md).

---

## 📋 Standard Operating Procedure (SOP)

Follow this 7-step process when developing, modifying, or testing this repository:

### Step 1: Environment Verification

Verify that Bun and Cargo/Rust toolchains are installed:

```bash
bun --version
cargo --version
```

> [!TIP]
> Move to the bleeding edge: `bun upgrade --canary` bumps Bun to the latest
> canary channel build (used to validate new TypeScript/JS runtime features).

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
- **Close Button (X)**: Minimizes to taskbar tray when enabled in preferences (default OFF — closing quits).

### Step 4: Version Sync Before Committing

Before any commit, synchronize the single global application version (`APP_VERSION` in `scripts/version.ts`) across all mirrors:

```bash
bun run before-commit
```

- `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` are auto-synced mirrors — NEVER hardcode or edit the version there; only `scripts/version.ts` (or `bun run before-commit --bump <major|minor|patch>`) may change it.
- Use `bun run before-commit --check` for read-only validation (exit 1 on drift) in CI or pre-commit hooks. CI runs this on every push/PR.

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

- Updates `scripts/version.ts` (the **only** place the version is defined) and auto-syncs the mirrors: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and refreshes the `src-tauri/Cargo.lock` root crate entry via `cargo generate-lockfile`.
- NEVER hand-edit the version in any mirror file — the script owns them.

#### Choosing `major`, `minor`, or `patch` (SemVer semantics)

| Bump    | Example          | Use when                                                                                                       | Result                               |
| :------ | :--------------- | :------------------------------------------------------------------------------------------------------------- | :----------------------------------- |
| `patch` | `0.9.0 → 0.9.1`  | Backward-compatible **bug fixes**, corrections, and polish — no new behavior. The safest and most common bump. | patch digit `+1`                     |
| `minor` | `0.9.0 → 0.10.0` | New **backward-compatible features** or additions (new toggles, IPC commands, views).                          | minor `+1`, patch → `0`              |
| `major` | `0.9.0 → 1.0.0`  | **Breaking changes** — incompatible config/behavior/IPC changes, removals, renames, new runtime requirements.  | major `+1`, minor → `0`, patch → `0` |

> [!NOTE]
> SemVer nuance: while below `1.0.0` (0.x), _anything_ may be considered breaking. The template convention: **patch = fixes, minor = features, major = deliberate breaking overhaul**. When the user does not specify, ask which level they want.

### 2. Update `CHANGELOG.md` (top of file)

Add the new release entry with the exact version and today's date:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### <Round / Release Title>

#### ⚛️ <Category>

- **Change**: Description.
```

- The `## [X.Y.Z]` header **must** match the bumped version — `before-commit --check` warns when it's missing. Each version may appear **exactly once** in the file (Keep a Changelog rule).
- Do this BEFORE regenerating the architecture map, so metrics include the edit.

### 3. Update Other Docs ONLY if Version-Dependent

`README.md`, `AUTO-UPDATE.md`, and `AGENTS.md` usually need no changes for a patch bump. Only edit them when their content actually references version-dependent facts (e.g. tech-stack tables, new scripts, changed workflow steps). Do not churn docs for the sake of it.

### 4. Regenerate the Architecture Map

```bash
bun run arch
```

- `ARCHITECTURE.md` embeds per-file metrics (sizes, lines, tokens) — the changelog edit and any new files change these, so regeneration MUST happen after steps 1–3.

### 5. Validate Everything (order: check, lint, then typecheck)

```bash
bun run before-commit --check   # all mirrors at X.Y.Z — exit 1 on drift
bun run lint                    # oxlint src test scripts
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

| Command                                                | What it does                                                                                                                                                                                                                                                                                             | Writes?                  |
| :----------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------- |
| `bun run before-commit`                                | **Sync mode (default).** Reads `APP_VERSION` from `scripts/version.ts` and propagates it into `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`; refreshes `src-tauri/Cargo.lock`. Prints a per-mirror report (`✅ in sync` / `🔧 fixed`).                                         | Yes                      |
| `bun run before-commit --check`                        | **Validation mode.** Compares every mirror against `APP_VERSION` **without writing**; exits `1` on any drift. Safe for CI and pre-commit hooks.                                                                                                                                                          | No                       |
| `bun run before-commit --full` (or `bun run validate`) | **Full Pro Pre-Commit Suite.** Runs all 8 quality gates sequentially, cheapest-first: version mirror check, TS typecheck (`tsc -b`), code lint (oxlint), Bun unit tests, production Vite build, `cargo check`, `cargo test`, and Architecture map refresh. Exits 0 on 100% pass with a timing breakdown. | Yes (`arch`)             |
| `bun run before-commit --bump patch`                   | Increments the patch digit in `scripts/version.ts` (`0.11.0 → 0.11.1`), then runs the sync.                                                                                                                                                                                                              | Yes (incl. `version.ts`) |
| `bun run before-commit --bump minor`                   | Increments the minor digit and zeroes patch (`0.11.0 → 0.12.0`), then runs the sync.                                                                                                                                                                                                                     | Yes (incl. `version.ts`) |
| `bun run before-commit --bump major`                   | Increments the major digit and zeroes minor + patch (`0.11.0 → 1.0.0`), then runs the sync.                                                                                                                                                                                                              | Yes (incl. `version.ts`) |
| `bun run before-commit --set <version>`                | Sets an exact custom SemVer string (e.g. `1.0.0-rc.1`) and propagates it to all mirrors.                                                                                                                                                                                                                 | Yes (incl. `version.ts`) |
| `bun run before-commit --stage`                        | Automatically stages updated mirror files with `git add`.                                                                                                                                                                                                                                                | Git index                |
| `bun run before-commit --install-hook`                 | Installs `.git/hooks/pre-commit` (runs `--check` + `lint` + `typecheck` before every commit).                                                                                                                                                                                                            | Yes (hook file)          |
| `bun run before-commit --uninstall-hook`               | Removes the `.git/hooks/pre-commit` hook cleanly.                                                                                                                                                                                                                                                        | Yes (removes hook)       |
| `bun run before-commit --help`                         | Prints the usage summary and exits `0`.                                                                                                                                                                                                                                                                  | No                       |

**Behavioral details:**

- **Changelog advisory**: after any bump, if `CHANGELOG.md` has no `## [<new version>]` header yet, the script prints a non-blocking `⚠️` reminder.
- **Exit codes**: `0` = all mirrors in sync / success; `1` = drift (`--check`), invalid usage, missing mirror files, or non-git repo (`--install-hook`).
- **Rejected combinations**: `--bump` without a part, unknown bump part, `--set` with invalid semver, and combining `--check` with `--bump`/`--set`.

---

## 🔧 Common Tasks — Quick Reference

| Task                                     | Command(s)                                                                                      |
| :--------------------------------------- | :---------------------------------------------------------------------------------------------- |
| Live development                         | `bun run tauri dev`                                                                             |
| Live development, fastest link path      | `bun run dev:fast` (`--check` to report the detected configuration only)                        |
| Add a runtime dependency                 | `bun add <package>`                                                                             |
| Add a dev dependency                     | `bun add -d <package>`                                                                          |
| Upgrade everything to @latest            | `bun run update-deps`                                                                           |
| Preview upgrades (no changes)            | `bun run update-deps --dry-run`                                                                 |
| Upgrade with pre-releases                | `bun run update-deps --prerelease` (beta/alpha/RC for direct deps; strictly-newer targets only) |
| Update the RTK CLI to the latest tag     | `bun run update:rtk` (queries the `rtk-ai/rtk` GitHub tags API for the newest tag)              |
| Bump version (then sync mirrors)         | `bun run before-commit --bump <major\|minor\|patch>`                                            |
| Set exact custom version                 | `bun run before-commit --set <semver>`                                                          |
| Check version drift (read-only)          | `bun run before-commit --check`                                                                 |
| Full pre-commit test suite               | `bun run validate` (or `bun run before-commit --full`)                                          |
| Auto-stage synced mirrors                | `bun run before-commit --stage`                                                                 |
| Install pre-commit git hook              | `bun run before-commit --install-hook`                                                          |
| Uninstall pre-commit git hook            | `bun run before-commit --uninstall-hook`                                                        |
| Format codebase (Prettier + cargo fmt)   | `bun run format`                                                                                |
| Check formatting without modifying files | `bun run format:check`                                                                          |
| Format frontend only (Prettier)          | `bun run format:frontend`                                                                       |
| Format backend only (cargo fmt)          | `bun run format:backend`                                                                        |
| Lint codebase (oxlint, TS7-compatible)   | `bun run lint`                                                                                  |
| Auto-fix lint issues                     | `bun run lint:fix`                                                                              |
| Run frontend unit tests                  | `bun test` (Bun runner, everything in `test/`)                                                  |
| Run Rust unit tests                      | `cargo test --manifest-path src-tauri/Cargo.toml`                                               |
| Run full pre-commit gate suite           | `bun run validate` (or `bun run before-commit --full`)                                          |
| Type-check the whole workspace           | `bun run typecheck`                                                                             |
| Rebrand & rename project starter kit     | `bun run rename-project --name "App Name" --identifier "com.id"`                                |
| Regenerate `ARCHITECTURE.md`             | `bun run arch`                                                                                  |
| Clone / refresh the doc mirrors          | `bun run docs:sync` (add `--only <id>` for one source)                                          |
| Check doc mirror freshness               | `bun run docs:check`                                                                            |
| Search all doc mirrors                   | `bun run docs:find "<query>"`                                                                   |
| Regenerate all app icons                 | `bun run create-icons`                                                                          |
| Purge Rust build artifacts               | `bun run clean`                                                                                 |
| Production build                         | `bun run build`                                                                                 |
| Commit / push                            | `rtk git add <files>` → `rtk git commit -m "feat(vX.Y.Z): ..."` → `rtk git push origin main`    |

---

## 💡 Best Practices & Coding Standards

1. **Package Management Rules**:
   - To add packages: `bun add <package>` (or `bun add -d <package>` for devDependencies).
   - To execute scripts: `bun run <script-name>`.
   - Never generate or commit `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`. Commit `bun.lock`.

2. **System Tray & Window Lifecycle Patterns**:
   - **Single-Instance Guard**: `tauri-plugin-single-instance` is registered first in the builder; launching the app a second time focuses the existing window instead of spawning a duplicate tray icon.
   - **Graceful Win32 Teardown**: Set `is_quitting = true` in `AppState` and call `window.close()` on the main window. This allows WebView2 to unregister window classes (`Chrome_WidgetWin_0`) cleanly through the Win32 message loop without throwing log errors.
   - **IPC State Syncing**: Use `get_minimize_to_tray` and `set_minimize_to_tray` IPC commands for preferences (persisted on disk to `$APP_DATA_DIR/<identifier>/settings.json`), and `@tauri-apps/plugin-autostart` for OS launch settings.
   - **No hardcoded version strings**: never write an app version into `src/` or `src-tauri/src/` — read `__APP_VERSION__` (Vite define) or `AppHandle::package_info()`.

3. **Rust Backend Conventions (`src-tauri/src/lib.rs`)**:
   - **IPC error contract**: preference-writing commands return `Result<(), String>` with descriptive messages; the frontend implements optimistic UI updates that roll back on `Err`.
   - **Disk-first persistence**: `set_minimize_to_tray` writes the new value to disk **before** mutating memory — a failed write leaves memory, disk, and UI consistent.
   - **Poison-safe locking**: never call `Mutex::lock().unwrap()` — use the `lock_guard()` helper which recovers from `PoisonError`.
   - **Single source of truth**: product name/tooltip/version come from `AppHandle::package_info()`; settings paths come from `app_config_dir()`; never reconstruct either by string matching.
   - **Descriptive `expect`/error messages**: icon bootstrapping fails gracefully with a setup error instead of a cryptic panic.

4. **Documentation-Driven Changes**:
   - Before changing anything framework-shaped — a lifecycle primitive, a boundary, a capability, a `tsconfig` flag — read the pinned local mirror (`bun run docs:find`), not memory.
   - Prefer the primitive the current major version prescribes: `onSettled` returning a cleanup (not `onMount`/`onCleanup`), two-argument `createEffect`, async `createMemo` (not `createResource`), `<Loading>`/`<Errored>` (not `<Suspense>`/`<ErrorBoundary>`).
   - Scope `<Loading>` to the smallest region its fallback should replace; keep navigation and controls outside it so they stay usable during a load.
   - Load persisted state with `createMemo(async …)` plus writable derived signals (`createSignal(fn)`), never by `.then()`-ing an IPC result into a pile of signals — the gap between mount and resolution is a window where a user's click lands on a placeholder value and is then silently overwritten.
   - Keep memo computes side-effect free. DOM writes, IPC writes, subscriptions and storage go in `createEffect`'s apply phase.
   - Never touch `localStorage` directly — use `readStored` / `writeStored` / `removeStored` from `src/lib/storage.ts`, which degrade a disabled or full store to "not persisted" instead of throwing into the render tree.
   - Give every `createEffect` apply phase and every `onSettled` callback a **block body**, unless it genuinely returns a cleanup function. Solid calls the return value as cleanup, so a concise arrow that happens to return a string or a number halts the reactive system on the effect's next run (`REACTIVITY_HALTED`).
   - Run frontend tests with `bun run test`, never a bare `bun test`: the script passes `--conditions browser` because `solid-js` resolves to its **SSR build** by default in Bun, where effects never run.
   - Grant Tauri permissions explicitly rather than relying on a plugin's `:default` set, so an upstream widening of that set cannot silently broaden this app's surface.

5. **SolidJS 2 / TypeScript Frontend Conventions (`src`)**:
   - **Component separation** (Round 14 layout): `App.tsx` is the shell (tabs, header, footer, status). `PreferencesTab.tsx` owns preference state + handlers. `AboutTab.tsx` is presentational and exports shared types. `ToggleSwitch.tsx` and `UpdateChecker.tsx` are reusable primitives.
   - **Stable callbacks for event listeners**: any callback registered by a mount-once listener (e.g. tray `"check-for-updates"` events) must be stable — use ref-based concurrency guards (`isCheckingRef` / `isInstallingRef`) and an empty dep array rather than reading state directly.
   - **`UpdateChecker` dual-variant rule**: exactly one instance (the card) may `autoCheckOnMount` and `listenForEvents`; footer variants pass `autoCheckOnMount={() => false} listenForEvents={() => false}` to prevent duplicate network requests.
   - **Optimistic rollback**: toggles update state immediately, then revert on IPC/plugin failure (see `PreferencesTab.tsx`).
   - **Never `import React`** — SolidJS 2's JSX transform handles element creation via `jsxImportSource: "@solidjs/web"`. Use `import type { Component }` / named type imports with `verbatimModuleSyntax`-safe patterns.
   - **Catch clauses**: use `error: unknown` + `instanceof Error` narrowing — never `any`.

6. **Accessibility Contract (ARIA)**:
   - **Tabs**: `role="tablist"` / `role="tab"` / `role="tabpanel"` with `aria-selected`, `aria-controls`, `aria-labelledby`, roving `tabIndex`, and arrow + Home/End keyboard navigation.
   - **Switches**: `role="switch"` + `aria-checked`, `tabIndex={0}`, Space/Enter activation, and a visually-hidden native checkbox for form semantics.
   - **Live regions**: `aria-live="polite"` on the footer status and update status regions; `role="progressbar"` with `aria-valuemin/max/now` on download progress.

7. **UI Theme & Aesthetic Standards**:
   - **Background**: 100% AMOLED Deep Black (`#000000`) — also painted inline in `index.html` to avoid white flash.
   - **Glassmorphism**: Translucent frosted cards (`backdrop-filter: blur(20px)`), `rgba(255, 255, 255, 0.08)` borders, and neon cyan (`#00f2fe`) accent glows.
   - **Typography**: Clean, sans-serif typography (`Inter`).

8. **Documentation Rules**:
   - Maintain [`README.md`](README.md), [`DOCUMENTATION.md`](DOCUMENTATION.md), [`TYPESCRIPT-7.md`](TYPESCRIPT-7.md), [`BUILD.md`](BUILD.md), [`TESTING.md`](TESTING.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md), [`CRUSH.md`](CRUSH.md), [`CHANGELOG.md`](CHANGELOG.md), [`AUTO-UPDATE.md`](AUTO-UPDATE.md), [`LICENSE`](LICENSE), [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), and [`AGENTS.md`](AGENTS.md).
   - When a dependency layer is added or a major version is bumped, update the mirror manifest in [`scripts/sync-docs.ts`](scripts/sync-docs.ts) and the reading map in [`DOCUMENTATION.md`](DOCUMENTATION.md) in the same change.
   - Keep inline code comments detailed and informative — every non-obvious function gets a doc comment explaining _why_, not just _what_.
   - After any file add/remove/rename, regenerate the architecture map (`bun run arch`).
   - Each changelog version header may appear exactly once; keep the exact `## [X.Y.Z] - YYYY-MM-DD` format.
