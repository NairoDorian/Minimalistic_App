# Contributing to Minimalistic App

Thank you for your interest in contributing to **Minimalistic App**! This guide outlines our development workflow, coding standards, and contribution processes.

---

## 📖 Philosophy & Core Principles

1. **Minimalistic & Focused**: Keep dependencies lean, architecture modular, and binary footprints lightweight.
2. **AMOLED Deep Black Aesthetic**: Maintain the 100% `#000000` AMOLED dark theme with frosted glassmorphic containers and subtle cyan/emerald glows.
3. **Robust Cross-Platform Reliability**: The app runs as a resident background taskbar utility with rock-solid single-instance lifecycle management, safe Win32 shutdown, and crash-resistant atomic persistence.
4. **Accessible by Default**: Full keyboard navigability (roving tabIndex, ARIA live regions, semantic roles) on all UI controls.

---

## 🚀 Getting Started

### 1. Prerequisites

- **Bun** (v1.2+) - The primary package manager.
- **Rust & Cargo** (2024 Edition / stable).
- Platform-specific build tools (see [BUILD.md](BUILD.md)).

### 2. Fork & Setup

```bash
# 1. Clone your fork
git clone https://github.com/YOUR_USERNAME/minimalistic-app.git
cd minimalistic-app

# 2. Install dependencies
bun install

# 3. Launch live development
bun run tauri dev
```

---

## 🌿 Git Branching Strategy

- **`main`**: Production-ready branch. Never commit directly to `main`.
- **Feature Branches**:
  - `feature/` - New capabilities, UI features, or IPC commands (e.g. `feature/audio-alerts`).
  - `fix/` - Bug fixes, stability patches, and corrections (e.g. `fix/tray-unminimize-focus`).
  - `refactor/` - Architectural cleanups without behavioral changes (e.g. `refactor/tab-state`).
  - `docs/` - Documentation updates and architecture maps (e.g. `docs/update-build-instructions`).

---

## 📝 Conventional Commits Standard

Commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <short description>
```

### Commit Types:

- `feat`: New feature or user-facing addition (e.g. `feat(tray): add shortcut trigger`).
- `fix`: Bug fix (e.g. `fix(persistence): prevent race condition during atomic rename`).
- `docs`: Documentation updates (e.g. `docs(build): add Fedora dependencies`).
- `style`: Formatting, whitespace, or Prettier adjustments without code logic changes.
- `refactor`: Code restructuring without functional changes.
- `chore`: Dependency updates, tooling, and build script maintenance.

### Release Commit Style:

For version releases, use the standardized format:

```bash
rtk git commit -m "feat(v0.11.0): deep audit round 5 — single-instance guard, ToggleSwitch extraction"
```

---

## 💡 Code Quality & Architecture Standards

### 1. Rust Backend Conventions (`src-tauri/src/lib.rs`)

- **Poison-Safe Mutex Locking**: Never call `mutex.lock().unwrap()`. Always use the poison-recovering `lock_guard()` helper.
- **Disk-First Atomic Persistence**: When persisting configuration to disk:
  1. Write serialized JSON to a temporary file (`settings.json.tmp`).
  2. Atomically rename to `settings.json`.
  3. Only mutate in-memory state after the disk write succeeds.
- **Descriptive Error Contracts**: IPC functions returning `Result<(), String>` must provide clear, user-actionable error messages.
- **Single Source of Truth**: Read metadata from `AppHandle::package_info()`; never hardcode version or app names.

### 2. SolidJS 2 & TypeScript Conventions (`src/`)

- **Modern JSX Transform**: Do not write `import React from 'react'`; import named symbols only (e.g. `import { createSignal, onSettled } from 'solid-js'`, `import type { Component } from 'solid-js'`). The SolidJS 2 JSX transform handles element creation without a React runtime import.
- **Strict Typing**: Strict TypeScript with `noUnusedLocals` and `verbatimModuleSyntax` safety. Never use `any`; use `unknown` with narrowing (`if (err instanceof Error)`).
- **Reactive Patterns**: Use `createSignal` for reactive state, `onSettled` for one-time mount side-effects (IPC calls, event-listener setup — explicitly commented as "one-time, not reactive"), and `createEffect` for reactive signal-dependent effects.
- **Component Structure**: Components receive props as a single object parameter (no destructuring at the parameter level). Reusable helpers/handlers are lifted to module scope to avoid re-creating closures on each render.
- **ARIA Accessibility**:
  - Tabs: `role="tablist"`, `role="tab"`, `role="tabpanel"`, with keyboard arrow handling.
  - Toggles: `role="switch"`, `aria-checked`, Space/Enter triggers, and visually-hidden checkboxes.
  - Dynamic status: `aria-live="polite"`.
- **Optimistic UI with Rollback**: Toggle switches update state immediately for instantaneous response, rolling back if the underlying IPC call rejects.
- **Component Modularity**: Keep tab views, toggle switches, and update checkers decoupled in separate component files under `src/components/`.
- **Type-Safe IPC**: All IPC calls go through the auto-generated `commands.*` wrappers in `src/bindings.ts` (produced by `tauri-specta`), never `invoke()` directly.
- **Boundaries**: Scope `<Loading>` around the smallest region its fallback should replace — keep the header, tab bar, and footer outside it so they stay usable while data loads. `<Errored>` fallbacks receive `(err, reset)`; offer `reset()` as the primary recovery action instead of a full webview reload.
- **Lifecycle**: `onSettled` returning a cleanup function is the SolidJS 2 component setup/teardown shape (it replaces the 1.x `onMount` + `onCleanup` pairing). `onCleanup` is reserved for library and custom-primitive internals. Every timer and listener a component starts must be torn down in that returned cleanup.
- **Async state**: persisted data is loaded with `createMemo(async …)` and consumed through writable derived signals (`createSignal(fn)`); a memo compute stays side-effect free, and anything imperative (DOM, IPC write, storage) goes in `createEffect`'s apply phase. See pattern 2 in [`CRUSH.md`](CRUSH.md).
- **Storage**: use `readStored` / `writeStored` / `removeStored` from `src/lib/storage.ts` rather than `localStorage` directly.

### 3. Documentation-First Rule

Every layer of this stack has its upstream documentation vendored locally under
`.docs/`, pinned to the branch that matches the version we run. Before changing
anything framework-shaped — a lifecycle primitive, a boundary, a Tauri
capability, a `tsconfig` flag — read the mirror:

```bash
bun run docs:sync                   # first time, or to refresh
bun run docs:find "createMemo"      # search Tauri 2 / SolidJS 2 / Bun / TypeScript at once
```

Cite the file you read in the PR description when a change is doc-driven. See
[`DOCUMENTATION.md`](DOCUMENTATION.md) for the full reading map and
[`TYPESCRIPT-7.md`](TYPESCRIPT-7.md) for the TypeScript 7 rules this repo follows.

### 4. Formatting Standards

- Keep files formatted with Prettier:
  ```bash
  bun run format
  ```
- Validate format compliance before pushing:
  ```bash
  bun run format:check
  ```

---

## ✅ Pull Request Checklist

Before submitting a Pull Request:

1. [ ] **Format Check**: `bun run format:check` passes without errors.
2. [ ] **Type Check**: `bun run typecheck` (`bun x tsc -b`) passes with 0 errors.
3. [ ] **Version Sync**: `bun run before-commit --check` confirms all mirrors are synchronized.
4. [ ] **Architecture Map**: `bun run arch` has updated `ARCHITECTURE.md` with any new or modified files.
5. [ ] **Full Validation Gate**: `bun run validate` passes 100% of all 8 pre-commit gates (version sync, types, lint, Bun tests, Vite build, cargo check, cargo test, arch map).
6. [ ] **Documentation**: Any new feature or configuration setting is documented in `README.md` and `CHANGELOG.md`.
7. [ ] **Doc-Driven Changes Cited**: Framework-shaped changes reference the local mirror they came from (`bun run docs:find`), and any new dependency layer has been added to the manifest in `scripts/sync-docs.ts` — see [`DOCUMENTATION.md`](DOCUMENTATION.md).
