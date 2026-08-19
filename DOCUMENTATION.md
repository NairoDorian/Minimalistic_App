# Documentation Map — every layer of the stack, referenced locally

This repository does not rely on memory or a web search to answer architecture
questions. **The upstream documentation for every layer of the stack is vendored
onto disk**, pinned to the branch that actually describes the version we run, and
searchable from one command.

```bash
bun run docs:sync              # clone missing mirrors, fast-forward existing ones
bun run docs:check             # status table: branch, commit, date, file count, size
bun run docs:find "capabilities"   # search every mirror at once (translations excluded)
```

> **The rule:** before answering _any_ question about Tauri, SolidJS, Bun, or
> TypeScript behaviour in this codebase — API shape, lifecycle, permission,
> config flag, migration semantics — **read the local mirror first**. Cite the
> file you read. Version-specific reasoning is the whole point: Solid 1.x and
> Solid 2.0 are different runtimes, Tauri 1 and Tauri 2 have different security
> models, and TypeScript 7 changed defaults that TypeScript 5 tutorials assume.

---

## 1. Why the mirrors are on disk and not in git

`.docs/` is **gitignored**. It holds roughly 200 MB of third-party repositories,
each under its own upstream license (see `THIRD_PARTY_LICENSES.md`). Vendoring
them into this repo's history would balloon the clone, mix licenses into our
tree, and go stale the moment upstream moves.

Instead, the **manifest is the committed source of truth**:
[`scripts/sync-docs.ts`](scripts/sync-docs.ts) declares every source — repo,
branch, sparse paths, entry directory, and _why it exists_. `bun run docs:sync`
reproduces the identical set of mirrors on any machine, on any platform, in
about a minute. Adding a layer to the app means adding its docs to that manifest.

Clones are shallow (`--depth 1 --single-branch`); the two large Microsoft
repositories are additionally partial (`--filter=blob:none --sparse`) so only the
prose directories are materialized. Updates are a fetch + hard reset, which is
correct here because the mirrors are read-only and shallow clones cannot merge
across an upstream force-push.

---

## 2. The mirrors

| Layer                     | Local path                           | Tracks       | Upstream                                                                        |
| ------------------------- | ------------------------------------ | ------------ | ------------------------------------------------------------------------------- |
| **Tauri 2**               | `.docs/tauri-docs/src/content/docs/` | `v2`         | [tauri-apps/tauri-docs](https://github.com/tauri-apps/tauri-docs/tree/v2)       |
| **SolidJS 2**             | `.docs/solid-docs/src/routes/`       | `v2-rebuild` | [solidjs/solid-docs](https://github.com/solidjs/solid-docs/tree/v2-rebuild)     |
| **Bun**                   | `.docs/bun-docs/content/docs/`       | `main`       | [RiskyMH/bun-docs](https://github.com/RiskyMH/bun-docs)                         |
| **TypeScript**            | `.docs/typescript-website/packages/` | `v2`         | [microsoft/TypeScript-Website](https://github.com/microsoft/TypeScript-Website) |
| **TypeScript 7 (native)** | `.docs/typescript-go/CHANGES.md`     | `main`       | [microsoft/typescript-go](https://github.com/microsoft/typescript-go)           |

Branch choice is load-bearing, not incidental:

- **`tauri-docs@v2`** — Tauri 1 docs describe a security model (allowlist) this
  app does not use. We use capabilities + permissions.
- **`solid-docs@v2-rebuild`** — **the only correct SolidJS reference for this
  codebase.** The `main` branch documents Solid 1.x, whose `createResource` /
  `onMount` / `<Suspense>` / `<ErrorBoundary>` idioms do not exist here. Solid
  2.0 replaced them with async memos, `onSettled`, `<Loading>`, and `<Errored>`.
- **`bun-docs@main`** — a maintained mirror of bun.sh/docs in plain MDX, which
  the official site is not published as.
- **`TypeScript-Website@v2`** — the source that renders
  [typescriptlang.org/docs](https://www.typescriptlang.org/docs/): the handbook
  plus a per-flag `tsconfig` reference.
- **`typescript-go@main`** — the native Go port that _is_ TypeScript 7. Its
  `CHANGES.md` is the authoritative list of behavioural differences. See
  [TYPESCRIPT-7.md](TYPESCRIPT-7.md).

---

## 3. Reading map — "I need to know X, read Y"

### Tauri 2 — `.docs/tauri-docs/src/content/docs/`

| Question                                                                              | Read                                                                                   |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Can the frontend call this plugin command?                                            | `security/capabilities.mdx`, `security/permissions.mdx`                                |
| What does `core:default` actually grant?                                              | `security/runtime-authority.mdx`, `reference/acl/`                                     |
| Adding a Rust IPC command                                                             | `develop/calling-rust.mdx`                                                             |
| Emitting an event to the webview                                                      | `develop/calling-frontend.mdx`                                                         |
| Managed state, `State<T>`, mutexes                                                    | `develop/state-management.mdx`                                                         |
| Tray icon, menus, window chrome                                                       | `learn/system-tray.mdx`, `learn/window-customization.mdx`                              |
| CSP, asset protocol, HTTP headers                                                     | `security/csp.mdx`, `security/asset-protocol.mdx`, `security/http-headers.mdx`         |
| Updater feed, signing, artifacts                                                      | `plugin/updater.mdx`, `distribute/Sign/`                                               |
| Installers & bundle targets per OS                                                    | `distribute/windows-installer.mdx`, `distribute/dmg.mdx`, `distribute/appimage.mdx`, … |
| `tauri.conf.json` field semantics                                                     | `develop/configuration-files.mdx`                                                      |
| Plugin we depend on (autostart, log, notification, process, single-instance, updater) | `plugin/<name>.mdx`                                                                    |
| Binary size, process model, IPC internals                                             | `concept/size.mdx`, `concept/process-model.md`, `concept/Inter-Process Communication/` |

**Note:** `src/content/docs/` also contains `de/ es/ fr/ ja/ zh-cn/` translation
trees. `bun run docs:find` skips them automatically; a raw `grep` will not.

### SolidJS 2 — `.docs/solid-docs/src/routes/`

| Question                                                  | Read                                         |
| --------------------------------------------------------- | -------------------------------------------- |
| How async works in the graph                              | `(2)concepts/(3)async-reactivity.mdx`        |
| `<Loading>` / `<Errored>` / `<Reveal>` placement          | `(2)concepts/(4)boundaries.mdx`              |
| Core reactivity model                                     | `(2)concepts/(0)reactivity.mdx`              |
| Coming from Solid 1.x idioms                              | `(6)migration/(0)from-solid-1.mdx`           |
| "Should this be an effect?"                               | `(5)guides/(0)avoid-unnecessary-effects.mdx` |
| Testing components                                        | `(5)guides/(0)testing.mdx`                   |
| Exact signature of any primitive                          | `reference/(1)solid-js/…`                    |
| DOM-side APIs (`render`, `Portal`, `class`/`style` props) | `reference/(2)solid-web/…`                   |

High-traffic reference pages for this codebase:

- `reference/(1)solid-js/(1)reactivity/create-memo.mdx` — async memos, plus the
  `loadingValue` option (commit #0 semantics).
- `reference/(1)solid-js/(1)reactivity/create-effect.mdx` — the **two-argument**
  form. Single-argument `createEffect(fn)` is removed in 2.0.
- `reference/(1)solid-js/(3)lifecycle-actions/on-settled.mdx` — the lifecycle
  primitive. Replaces `onMount` + `onCleanup` for component setup/teardown.
- `reference/(1)solid-js/(6)advanced/(2)specialized-reactivity/on-cleanup.mdx` —
  why `onCleanup` is now a library-internals tool, not a component-body tool.
- `reference/(1)solid-js/(1)reactivity/is-pending.mdx` and `latest.mdx` — reading
  in-flight state without suspending.
- `reference/(1)solid-js/(5)components-jsx/errored.mdx` — the `(err, reset)`
  fallback signature.

### Bun — `.docs/bun-docs/content/docs/`

| Question                                     | Read                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------- |
| Test runner API, matchers, lifecycle         | `test/writing-tests.mdx`, `test/lifecycle.mdx`, `test/discovery.mdx` |
| DOM testing / happy-dom                      | `test/dom.mdx`                                                       |
| Coverage thresholds                          | `test/code-coverage.mdx`                                             |
| `bun install` behaviour, lockfile            | `pm/lockfile.mdx`, `pm/isolated-installs.mdx`                        |
| `bunfig.toml`                                | `runtime/bunfig.mdx`                                                 |
| Running/authoring the `scripts/*.ts` tooling | `runtime/bun-apis.mdx`, `runtime/file-io.mdx`                        |
| Bun + TypeScript                             | `typescript.mdx`                                                     |

### TypeScript — `.docs/typescript-website/packages/`

| Question                                 | Read                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------- |
| Any `tsconfig` flag, precisely           | `tsconfig-reference/copy/en/options/<flag>.md`                        |
| Language semantics                       | `documentation/copy/en/handbook-v2/`                                  |
| Module resolution, `bundler` mode        | `documentation/copy/en/modules-reference/`                            |
| What landed in which release             | `documentation/copy/en/release-notes/`                                |
| **TypeScript 7 behavioural differences** | `.docs/typescript-go/CHANGES.md` + [TYPESCRIPT-7.md](TYPESCRIPT-7.md) |

---

## 4. Layers with no mirror (and why they need none)

| Layer                             | Where its docs already are                                                                                                                                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rust (std, book, reference)**   | Already offline on every machine with a toolchain: `rustup doc`, `rustup doc --std`, `rustup doc --book`. Nothing to clone.                                                                                                       |
| **Every Rust crate we depend on** | `cargo doc --open --manifest-path src-tauri/Cargo.toml` builds local API docs for `tauri`, `specta`, `windows`, `evdev`, `objc2`, and the rest, at the exact versions in `Cargo.lock`. Online mirror: [docs.rs](https://docs.rs). |
| **Tauri Rust API**                | `cargo doc -p tauri --open`, or [docs.rs/tauri](https://docs.rs/tauri). The prose mirror above covers concepts; docs.rs covers signatures.                                                                                        |
| **Vite 8**                        | [vite.dev/config](https://vite.dev/config/) — one config file (`vite.config.ts`), no ambiguity worth mirroring.                                                                                                                   |
| **oxlint**                        | [oxc.rs/docs/guide/usage/linter](https://oxc.rs/docs/guide/usage/linter.html); rules configured in `.oxlintrc.json`.                                                                                                              |
| **Prettier**                      | [prettier.io/docs](https://prettier.io/docs/en/); config in `.prettierrc`.                                                                                                                                                        |
| **Lucide icon geometry**          | Vendored directly as SVG paths in `src/lib/icons.tsx` — no runtime dependency, no docs needed.                                                                                                                                    |

---

## 5. Working agreement

1. **Answer from the mirror, cite the file.** "Per
   `.docs/solid-docs/.../(4)boundaries.mdx`, a loading boundary belongs around
   the smallest coherent region" beats "I think Solid wants…".
2. **Refresh before a doc-driven change.** `bun run docs:sync` first; these are
   fast-moving pre-release stacks (Solid 2 RC, TypeScript 7 dev, Bun canary).
3. **Never edit anything under `.docs/`.** It is a read-only checkout; the next
   sync hard-resets it and your edit is gone.
4. **New dependency ⇒ new manifest entry.** If a layer is significant enough to
   ship in the app, its documentation belongs in `scripts/sync-docs.ts`.
5. **Prefer the local search.** `bun run docs:find "<query>"` searches all five
   mirrors and skips `.git` and translation directories, so one query does not
   return the same page in five languages.

---

## 6. Repository documentation index

| File                                               | Covers                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| [README.md](README.md)                             | Product overview, SOP, feature architecture, tech stack, project structure |
| [AGENTS.md](AGENTS.md)                             | Development procedure and workflow rules for agents and humans             |
| [ARCHITECTURE.md](ARCHITECTURE.md)                 | Generated file inventory and data flow (`bun run arch`)                    |
| [BUILD.md](BUILD.md)                               | Toolchain prerequisites, per-OS setup, production builds                   |
| [TESTING.md](TESTING.md)                           | The 8-gate pre-commit suite, unit-test layout, manual QA matrix            |
| [SECURITY.md](SECURITY.md)                         | Capability model, hotkey hook, CSP, disclosure policy                      |
| [AUTO-UPDATE.md](AUTO-UPDATE.md)                   | Updater architecture, Minisign signing, release workflow                   |
| [CONTRIBUTING.md](CONTRIBUTING.md)                 | Branching, conventional commits, code standards                            |
| [CRUSH.md](CRUSH.md)                               | Copy-paste patterns for the Rust and SolidJS layers                        |
| [TYPESCRIPT-7.md](TYPESCRIPT-7.md)                 | TS7 migration notes and this repo's compliance audit                       |
| **DOCUMENTATION.md**                               | **This file — where the upstream docs live and when to read them**         |
| [CHANGELOG.md](CHANGELOG.md)                       | Release history                                                            |
| [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) | Dependency licenses                                                        |
