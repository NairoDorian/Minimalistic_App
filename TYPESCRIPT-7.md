# TypeScript 7 — what changed, and where this repo stands

This project pins a **TypeScript 7 development build** (`typescript` in
`package.json`; run `bun run typecheck`, which invokes `tsc -b`). TypeScript 7 is
the native Go port — a different compiler implementation, not a feature release —
so tutorials, Stack Overflow answers, and `tsconfig` templates written for
TypeScript 5.x carry assumptions that no longer hold.

**Primary sources**

- Announcement: <https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/>
- Handbook & per-flag `tsconfig` reference: <https://www.typescriptlang.org/docs/>
  — mirrored locally at `.docs/typescript-website/packages/` (`bun run docs:sync`)
- **Authoritative behavioural diff:** `.docs/typescript-go/CHANGES.md`
  ([microsoft/typescript-go](https://github.com/microsoft/typescript-go))

See [DOCUMENTATION.md](DOCUMENTATION.md) for how the mirrors are managed.

---

## 1. Why it matters here

TypeScript 7 reports **8–12× faster full builds** and materially lower memory use
than 6.0, with editor responsiveness improving by a similar factor. For a repo
this size the wall-clock win is small in absolute terms, but the _defaults_
changed — and those affect us whether we notice or not.

---

## 2. Changed defaults (relative to 6.0)

| Option                         | TS 7 default                     | Consequence                                                                                              |
| ------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `strict`                       | `true`                           | Strictness is opt-**out**, not opt-in                                                                    |
| `module`                       | `esnext`                         |                                                                                                          |
| `target`                       | current stable ES (`esnext - 1`) |                                                                                                          |
| `types`                        | `[]`                             | **Global `@types` packages are no longer auto-included.** Anything you rely on must be listed explicitly |
| `rootDir`                      | `./`                             | A `tsconfig.json` above your sources may need `rootDir` set                                              |
| `noUncheckedSideEffectImports` | `true`                           |                                                                                                          |
| `libReplacement`               | `false`                          |                                                                                                          |
| `stableTypeOrdering`           | `true`                           | Cannot be disabled                                                                                       |

## 3. Removed — these are now hard errors

- `target: es5`, and `downlevelIteration`
- `moduleResolution: node` / `node10` / `classic` — use `nodenext` or `bundler`
- `module: amd` / `umd` / `systemjs` / `none` — use `esnext` or `preserve`
- `baseUrl` — express `paths` relative instead
- `esModuleInterop: false`, `allowSyntheticDefaultImports: false`,
  `alwaysStrict: false` — the permissive side is gone
- The `module` keyword for namespaces; `assert` on imports (use `with`)
- Passing file paths on the CLI when a `tsconfig.json` exists, unless
  `--ignoreConfig` is given

## 4. Behavioural changes

**Template literal types iterate by Unicode code point**, not UTF-16 code unit:

```ts
type HeadTail<S> = S extends `${infer Head}${infer Tail}` ? [Head, Tail] : never;
type R = HeadTail<'😀abc'>;
//   TS 7: ["😀", "abc"]        — matches `for...of`
//   TS 6: ["\ud83d", "\ude00abc"]
```

**JavaScript/JSDoc support was substantially trimmed** to match TypeScript-file
semantics: values can no longer be used as types (use `typeof`), `@enum` is gone
(use `@typedef`), bare `?` is invalid (use `any`), `@class` no longer makes a
function a constructor, postfix `!` is unsupported, and Closure-style syntax was
removed. Constructor functions with `prototype` assignment are no longer
recognized — use `class`. The full list is `.docs/typescript-go/CHANGES.md`.

> **This repo is unaffected by every item in that paragraph:** `src/`, `test/`,
> and `scripts/` are 100 % `.ts` / `.tsx` with no `.js` sources, no JSDoc types,
> and no `allowJs`.

## 5. New CLI flags

| Flag               | Purpose                                                                               |
| ------------------ | ------------------------------------------------------------------------------------- |
| `--checkers <n>`   | Type-checker parallelism (default `4`). Higher = faster on big codebases, more memory |
| `--builders <n>`   | Parallelizes project-reference builds in `--build` mode                               |
| `--singleThreaded` | Disables all parallelism — for debugging or constrained CI                            |

This repo's two projects (`tsconfig.json` + `tsconfig.scripts.json`) typecheck in
well under a second, so the defaults are correct and `bun run typecheck` passes
no tuning flags. Revisit only if the source tree grows by an order of magnitude.

Watch mode was rebuilt on a Go port of Parcel's file watcher — no more
CPU-burning polling on large trees.

## 6. Ecosystem caveat

TypeScript 7 has **no stable programmatic API** until 7.1. Tools that drive the
compiler API — Vue, Svelte, Astro, MDX, Angular templates, `typescript-eslint` —
still need TypeScript 6 for editor/lint integration.

**This does not affect us.** Linting is [oxlint](https://oxc.rs) (a native Rust
linter that does not consume the TypeScript compiler API), and the frontend is
SolidJS with plain `.tsx` — no template compiler in the type-check path. That is
precisely why the `lint` gate stays green on a TS7 dev build where a
`typescript-eslint` setup would not.

---

## 7. Compliance audit of this repository

Audited against the TS7 default/removal list above.

### `tsconfig.json` (app: `src/`, `test/`, `vite.config.ts`)

| Setting                                                                                                                        | Status                                                     |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `target: ES2022`                                                                                                               | ✅ Allowed — only `es5` was removed                        |
| `module: ESNext`                                                                                                               | ✅                                                         |
| `moduleResolution: bundler`                                                                                                    | ✅ The supported replacement for `node`/`node10`/`classic` |
| `types: ["vite/client", "node", "bun"]`                                                                                        | ✅ **Explicit** — required now that the default is `[]`    |
| `strict: true`                                                                                                                 | ✅ Matches the new default; kept explicit for clarity      |
| `jsx: preserve` + `jsxImportSource: "@solidjs/web"`                                                                            | ✅ Vite's Solid plugin performs the JSX transform          |
| `noEmit`, `isolatedModules`, `allowImportingTsExtensions`, `resolveJsonModule`, `skipLibCheck`, `useDefineForClassFields`      | ✅ All still supported                                     |
| `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | ✅ Strictness beyond `strict` — retained                   |
| `baseUrl`                                                                                                                      | ✅ Not used (would now be an error)                        |
| `downlevelIteration`, `esModuleInterop: false`, `alwaysStrict: false`                                                          | ✅ Not used                                                |

### `tsconfig.scripts.json` (tooling: `scripts/`)

| Setting                                                         | Status                                                                                                                                                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target: ES2023`, `module: ESNext`, `moduleResolution: bundler` | ✅                                                                                                                                                                                             |
| `composite: true` + `outDir`                                    | ✅ Project reference from the root config                                                                                                                                                      |
| `types: ["node"]`                                               | ✅ Explicit. **Consequence:** `scripts/*.ts` must use Node APIs, not `Bun.*` globals — `scripts/sync-docs.ts` uses `process.argv` and `fileURLToPath(import.meta.url)` for exactly this reason |

**Result: no changes required.** Both projects are TypeScript 7-clean today, and
`bun run typecheck` passes on the pinned dev build.

### Standing rules

1. Keep `types` explicit in both configs. A `@types/*` package added to
   `devDependencies` is **invisible** to the compiler until it is listed.
2. Never introduce `baseUrl`. Use relative paths, or `paths` with relative
   targets.
3. Keep `scripts/` on Node APIs unless `"bun"` is deliberately added to that
   project's `types`.
4. New source files are `.ts` / `.tsx`. Do not add `.js` sources or JSDoc-typed
   modules — that is the surface TS7 reshaped most.
5. Re-run this audit whenever the pinned `typescript` version changes, against a
   freshly synced `.docs/typescript-go/CHANGES.md`.
