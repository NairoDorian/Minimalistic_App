import fs from 'node:fs';
import path from 'node:path';
import {
  pack,
  searchFiles,
  generateTreeString,
  loadFileConfig,
  mergeConfigs,
  type PackResult,
} from 'repomix';

// 1-line description registry for files in the repository. Post-processed onto
// the Repomix-generated inventory (paths are POSIX-style, relative to the repo root).
const fileDescriptions: Record<string, string> = {
  '.gitignore':
    'Git ignore configuration excluding build artifacts, node_modules, editor noise, logs, foreign lockfiles, and OS metadata.',
  '.gitattributes':
    'Git line-ending normalization (LF for code, CRLF for Windows scripts) and binary asset protection rules.',
  '.editorconfig':
    'Cross-editor workspace configuration for indentation, charset, and whitespace trimming.',
  '.prettierrc':
    'Prettier formatting configuration enforcing single quotes, 2-space indentation, and es5 trailing commas.',
  '.prettierignore':
    'Prettier ignore configuration excluding dist, target, node_modules, logs, and lockfiles.',
  '.oxlintrc.json':
    'oxlint (TS7-compatible linter) configuration with correctness/suspicious/perf categories and unicorn/import/typescript plugin rules.',
  '.vscode/extensions.json':
    'VS Code workspace extension recommendations (rust-analyzer, tauri-vscode, prettier, oxlint).',
  '.vscode/settings.json':
    'VS Code workspace editor settings for format-on-save, Prettier default formatter, rust-analyzer, and oxlint on-type linting.',
  '.github/workflows/ci.yml':
    'Cross-platform GitHub Actions CI validating Prettier formatting, oxlint lint, TypeScript types (tsc), Vite production bundle, Bun unit tests (bun test), Rust compilation check (cargo check), and Rust unit tests (cargo test) across Linux, macOS, and Windows.',
  '.github/workflows/release.yml':
    'Multi-platform Tauri 2 GitHub Actions release workflow publishing draft releases and signed updater bundles.',
  'package.json':
    'Project manifest containing Bun scripts (dev, build, typecheck, format, arch, create-icons, update-deps, update:rtk, clean), dependencies (SolidJS 2, Tauri v2), and TypeScript tooling.',
  'repomix.config.json':
    'Repomix configuration for metadata-only architecture output (gitignore-aware, no file contents).',
  'tsconfig.json':
    'TypeScript root configuration with strict type checking, bundler resolution, and enforced noUnusedLocals.',
  'tsconfig.scripts.json':
    'Separate TypeScript config for Node.js scripts — uses ES2022 lib without DOM types to avoid type collisions.',
  'vite.config.ts':
    'Vite bundler configuration optimized for SolidJS 2 and Tauri v2 dev server integration, injecting __APP_VERSION__ at build time.',
  'index.html': 'Main HTML entry point featuring Google Fonts Inter and root mount target.',
  'README.md':
    "User manual and documentation specifying feature list, SOP procedure, and 'bun run tauri dev' command.",
  'BUILD.md':
    'Comprehensive cross-platform build instructions, prerequisites for Windows/macOS/Linux, and troubleshooting guides.',
  'TESTING.md':
    'Testing & QA guide detailing the 8-gate automated validation suite, unit-test layout, and the manual desktop verification matrix.',
  'CONTRIBUTING.md':
    'Contributor guidelines, Git branching strategy, Conventional Commits standard, and coding rules for Rust and SolidJS 2.',
  'SECURITY.md':
    'Security policy, Tauri v2 capability scoping, atomic persistence guarantees, and vulnerability reporting procedures.',
  'CRUSH.md':
    'Rapid developer & AI agent cheat sheet with CLI commands, Rust idioms, SolidJS 2 patterns, and design tokens.',
  'CHANGELOG.md': 'Version history tracking releases and features starting with v0.1.0.',
  LICENSE: 'Standard MIT open-source license.',
  'THIRD_PARTY_LICENSES.md':
    'Third-party software, font (Inter OFL-1.1), icon (Lucide MIT), and runtime license attributions.',
  'AGENTS.md':
    'Guidelines, SOP procedure, and technical context for AI coding agents operating on this repository.',
  'AUTO-UPDATE.md':
    'Documentation and setup guide for GitHub Releases auto-updater and release CI/CD workflow.',
  'DOCUMENTATION.md':
    'Master documentation map: where the vendored upstream docs for every stack layer live under .docs/, which file to read for which question, and the working agreement for doc-driven changes.',
  'TYPESCRIPT-7.md':
    'TypeScript 7 (native Go port) changed defaults, removed options, behavioural differences, new CLI flags, and the compliance audit of both tsconfig projects in this repository.',
  'src/main.tsx':
    'SolidJS 2 application entry point rendering App root (JSX transform handles element creation).',
  'src/App.tsx':
    'Application shell: modular tab navigation (ARIA tabs), header with drag region, footer status bar, and app-info IPC loading.',
  'src/vite-env.d.ts':
    'Vite client type references and declaration of the build-time __APP_VERSION__ constant.',
  'src/lib/tauri.ts': 'Shared Tauri v2 runtime detection utility exporting the isTauri constant.',
  'src/lib/theme.ts':
    'Theme accent customization engine with 5 curated neon color palettes and dynamic CSS variable injection.',
  'src/lib/toast.ts':
    'Reactive toast notification event bus and helper methods for triggering toasts across the app.',
  'src/lib/shortcuts.ts':
    'Application shortcut registry: default bindings, persisted per-machine user overrides, conflict detection, and event-to-action resolution built on lib/keyboard.',
  'src/lib/keyboard.ts':
    'Self-contained cross-platform keyboard/hotkey engine (handy-keys inspired): side-aware modifier flags, portable Mod+ spec parsing/formatting, layout-independent code matching, and a side-tracking keyboard listener.',
  'src/lib/appMeta.ts':
    'Product identity constants (APP_NAME, APP_SLUG) and localStorage key namespacing — the single place the frontend hardcodes the app name, rewritten by rename-project.',
  'src/lib/download.ts':
    'Blob download helper shared by settings backup export and the diagnostic report, with deferred object-URL revocation so webviews do not cancel the download.',
  'src/components/HotkeyRecorder.tsx':
    '"Press a shortcut" capture control that claims the keyboard while armed, previews the held chord live, and commits a canonical spec string.',
  'test/keyboard.test.ts':
    'Automated Bun unit tests covering hotkey parsing, formatting, platform modifier resolution, event matching, and the side-aware keyboard listener.',
  '.vscode/launch.json':
    'VS Code debug launch configurations for attaching to the Tauri Rust backend and the webview frontend.',
  'src/components/GlobalHotkeysSection.tsx':
    'Preferences section for system-wide hotkeys: enable toggle, per-action recorders, listener status, and the macOS Accessibility permission prompt.',
  'src-tauri/src/global_hotkeys.rs':
    'App-level global hotkey glue: the action set, persisted bindings, the supervisor that rebuilds the OS listener on change, dispatch to window actions, and the status the UI reads.',
  'src-tauri/src/hotkeys/mod.rs':
    'Root of the embedded cross-platform global-hotkey engine (vendored from handy-keys, MIT) — re-exports Hotkey, Modifiers, Key, KeyboardListener, and HotkeyManager.',
  'src-tauri/src/hotkeys/error.rs':
    'Hand-written error enum for the hotkey engine with user-facing Display messages (no thiserror dependency); converts into the IPC String error.',
  'src-tauri/src/hotkeys/listener.rs':
    'Platform-agnostic KeyboardListener: raw key-event stream used for hotkey recording, with clean thread shutdown per backend.',
  'src-tauri/src/hotkeys/manager.rs':
    'HotkeyManager: filters the raw key stream against registered hotkeys and emits press/release events, including modifier-only hotkeys.',
  'src-tauri/src/hotkeys/types/mod.rs':
    'Re-exports for the hotkey type layer (Hotkey, Key, Modifiers, and the event structs).',
  'src-tauri/src/hotkeys/types/hotkey.rs':
    'Hotkey definition (modifiers + optional key), the "Ctrl+Alt+Space" string grammar, and the hotkey/key event structs.',
  'src-tauri/src/hotkeys/types/key.rs':
    'Cross-platform Key enum (letters, digits, F1–F24, navigation, punctuation, keypad, media, mouse buttons) with case-insensitive parsing and Display.',
  'src-tauri/src/hotkeys/types/modifiers.rs':
    'Hand-rolled side-aware modifier bitset (no bitflags dependency) with alias parsing, the platform-resolving Mod/CmdOrCtrl alias, and pattern-vs-state match semantics.',
  'src-tauri/src/hotkeys/platform/mod.rs':
    'Platform backend selection for the hotkey engine (macOS / Windows / Linux).',
  'src-tauri/src/hotkeys/platform/state.rs':
    'Shared listener state and modifier reconciliation helpers that recover from a stuck modifier identically on Windows and Linux.',
  'src-tauri/src/hotkeys/platform/windows/mod.rs': 'Windows hotkey backend module declarations.',
  'src-tauri/src/hotkeys/platform/windows/listener.rs':
    'Windows backend: WH_KEYBOARD_LL / WH_MOUSE_LL low-level hooks with a message loop, session-change hook reinstall, and hotkey blocking.',
  'src-tauri/src/hotkeys/platform/windows/keycode.rs':
    'Windows virtual-key and scancode to Key mapping, including layout-independent punctuation via scancode position.',
  'src-tauri/src/hotkeys/platform/macos/mod.rs': 'macOS hotkey backend module declarations.',
  'src-tauri/src/hotkeys/platform/macos/listener.rs':
    'macOS backend: CGEventTap keyboard tap running on a dedicated CFRunLoop thread, with tap re-enable on timeout and clean shutdown.',
  'src-tauri/src/hotkeys/platform/macos/keycode.rs':
    'macOS virtual keycode to Key mapping (including JIS and media keys).',
  'src-tauri/src/hotkeys/platform/macos/permissions.rs':
    'macOS Accessibility permission check and a helper that opens the exact System Settings pane.',
  'src-tauri/src/hotkeys/platform/linux/mod.rs': 'Linux hotkey backend module declarations.',
  'src-tauri/src/hotkeys/platform/linux/listener.rs':
    'Linux backend: reads /dev/input evdev devices directly (Wayland, X11, and console alike) with hotplug via inotify, and uinput re-injection for blocking.',
  'src-tauri/src/hotkeys/platform/linux/keycode.rs': 'Linux evdev keycode to Key mapping.',
  'src/components/ToggleSwitch.tsx':
    'Reusable accessible ARIA toggle switch (role=switch, Space/Enter keys, visually-hidden checkbox) used by the Preferences tab.',
  'src/components/UpdateChecker.tsx':
    'Auto-update checker component handling release checks, streamed progress, and app relaunch.',
  'src/components/PreferencesTab.tsx':
    'Preferences tab panel owning autostart and minimize-to-tray toggle state, handlers, theme picker, and update checker card.',
  'src/components/AboutTab.tsx':
    'Presentational System & About tab panel with diagnostic grid, clipboard copy, and config folder opener.',
  'src/components/DeveloperTab.tsx':
    'Developer Hub tab providing live IPC command execution, toast benchmarks, memory telemetry, and factory reset actions.',
  'src/components/Toast.tsx':
    'Toast notification container and animated item components with auto-dismiss timers and ARIA live regions.',
  'src/components/ErrorBoundary.tsx':
    'Top-level SolidJS 2 Error Boundary with glassmorphic crash card, stack trace toggle, and copy logs action.',
  'src/components/KeyboardShortcutsModal.tsx':
    'Keyboard shortcuts cheat sheet and rebinding surface: accessible ARIA dialog with a focus trap and a live HotkeyRecorder per shortcut.',
  'src/index.css':
    '100% AMOLED deep black theme (#000000) with glassmorphism, glowing toggle switches, and reduced-motion support.',
  'src/bindings.ts':
    'Auto-generated tauri-specta type-safe Rust↔TypeScript IPC bindings consumed by the SolidJS frontend via the `commands.*` wrappers.',
  'src/components/DevConsole.tsx':
    'Live dev-console log viewer: filterable severity badges, real-time backend log tailing, clear/pause controls, and dedup logic for the dev-log bus snapshot replay.',
  'src/lib/console.ts':
    'In-memory dev-log event bus (push / clear / subscribe) shared between the Rust log sink and the DevConsole view.',
  'src/lib/icons.tsx':
    'Self-contained SolidJS 2 icon set (brand, tray, toast, action glyphs) with AMOLED deep-black styling — replacing the removed lucide-solid dependency.',
  'src/lib/logViewer.ts':
    'Pure log-parsing utilities: severity classification from marker tokens and count-aware reconciliation of the live event stream against polled on-disk log lines.',
  'src/lib/settingsBackup.ts':
    'Settings backup/restore helpers: export/import to JSON with a sanitization layer, plus the FALLBACK_SETTINGS default constant.',
  'test/logViewer.test.ts':
    'Automated Bun unit tests validating log severity classification and live-vs-disk line reconciliation.',
  'test/settings.test.ts':
    'Automated Bun unit tests validating settings backup sanitization and the FALLBACK_SETTINGS structure.',
  'test/shortcuts.test.ts':
    'Automated Bun unit tests validating the shortcut registry, rebinding/override store, conflict detection, and action resolution.',
  'scripts/rename-project.ts':
    '1-command project customizer & renamer CLI script to rebrand the starter kit for new applications.',
  'test/version.test.ts':
    'Automated Bun unit tests validating SemVer format and version consistency.',
  'test/theme.test.ts':
    'Automated Bun unit tests validating theme preset definitions and color tokens.',
  'src-tauri/Cargo.toml':
    'Cargo manifest declaring Rust dependencies: tauri v2, autostart, updater, process, serde, and serde_json.',
  'src-tauri/tauri.conf.json':
    'Tauri v2 configuration defining window dimensions, updater endpoints, and tray bundle.',
  'src-tauri/build.rs': 'Rust build script initializing Tauri build environment.',
  'src-tauri/capabilities/default.json':
    'Tauri v2 capability definitions granting core, autostart, updater, process, and notification permissions to the main window.',
  'src-tauri/src/lib.rs':
    "Core Rust backend implementing System Tray menu ('Open', 'Check for Updates', 'Quit'), autostart, IPC settings persistence, and window hide event intercept.",
  'src-tauri/src/main.rs':
    'Main Rust entry point launching the lib run loop without extra Windows console.',
  'src-tauri/icons/32x32.png': 'Application tray/window icon at 32x32 pixels.',
  'src-tauri/icons/128x128.png': 'Application icon at 128x128 pixels.',
  'src-tauri/icons/128x128@2x.png': 'HiDPI application icon at 256x256 pixels (128x128 @2x).',
  'src-tauri/icons/icon.png': '512x512 master application icon.',
  'src-tauri/icons/icon.ico': 'Multi-resolution Windows icon container (16/32/48/64/128/256).',
  'src-tauri/icons/icon.icns': 'Valid macOS Apple Icon Image container (icp4-ic15, base + retina).',
  'scripts/generate-arch.ts':
    'Repomix pack() API-driven generator producing ARCHITECTURE.md with tree and per-file metadata inventory.',
  'scripts/create-icons.ts':
    'Cross-platform icon generator producing multi-size PNG, multi-entry ICO, and valid ICNS assets for Tauri v2.',
  'scripts/update-deps.ts':
    'End-to-end automated update & build validation pipeline script for Bun packages & Cargo crates.',
  'scripts/update-rtk.ts':
    'RTK CLI updater that resolves the latest rtk-ai/rtk GitHub tag and runs `cargo install --git --tag <tag> --force`.',
  'scripts/sync-docs.ts':
    'Documentation mirror manager: the committed manifest of every upstream doc source (Tauri 2 @ v2, SolidJS 2 @ v2-rebuild, Bun, TypeScript-Website, typescript-go), with shallow/sparse clone, fast-forward update, status reporting, and cross-mirror search that skips translation directories.',
  'scripts/version.ts':
    'Global single source of truth for the application version (APP_VERSION constant) consumed by vite.config.ts and before-commit.ts.',
  'scripts/before-commit.ts':
    'Version synchronization & validation script propagating APP_VERSION to package.json, Cargo.toml, and tauri.conf.json (+ Cargo.lock root entry via cargo generate-lockfile) with --check, --bump, --full (7-step suite incl. lint + unit tests), and --install-hook modes.',
  'src-tauri/Cargo.lock':
    'Rust dependency lockfile, committed to track exact crate versions for reproducible builds.',
};

/**
 * Reads the product name from `tauri.conf.json` so the generated document
 * follows a `rename-project` rebrand instead of hardcoding the template's name.
 */
function resolveProductName(rootDir: string): string {
  try {
    const raw = fs.readFileSync(path.join(rootDir, 'src-tauri', 'tauri.conf.json'), 'utf8');
    const parsed = JSON.parse(raw) as { productName?: unknown };
    return typeof parsed.productName === 'string' ? parsed.productName : 'this application';
  } catch {
    return 'this application';
  }
}

/** Human-readable byte size (e.g. `1.2 KB`). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Normalize OS-native separators to POSIX so keys match the description registry. */
function toPosix(p: string): string {
  return p.replaceAll('\\', '/');
}

/**
 * Converts Repomix's 2-space-indented tree into box-drawing characters
 * (├── / └── / │) for a more readable architecture map.
 */
function toBoxDrawingTree(treeString: string): string {
  const entries = treeString.split('\n').map((line) => {
    const trimmed = line.trim();
    return { depth: Math.round((line.length - trimmed.length) / 2), name: trimmed };
  });

  // isLast[i]: entry i has no following sibling at the same depth.
  const isLast = Array.from({ length: entries.length }, () => true);
  for (let i = entries.length - 2; i >= 0; i--) {
    const current = entries[i];
    if (current === undefined) continue;
    const next = entries.slice(i + 1).find((e) => e.depth <= current.depth);
    if (next !== undefined && next.depth === current.depth) isLast[i] = false;
  }

  // Nearest ancestor entry at a given depth. Repomix emits the tree in DFS
  // preorder, so scanning backwards always hits the direct ancestor first.
  const findAncestor = (i: number, depth: number): number => {
    for (let j = i - 1; j >= 0; j--) {
      const entry = entries[j];
      if (entry === undefined) continue;
      if (entry.depth === depth) return j;
      if (entry.depth < depth) break;
    }
    return -1;
  };

  const lines: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === undefined) continue;
    const { depth, name } = entry;
    const prefix: string[] = [];
    for (let d = 1; d <= depth; d++) {
      const anc = findAncestor(i, d - 1);
      prefix.push(anc >= 0 && !isLast[anc] ? '│   ' : '    ');
    }
    lines.push(`${prefix.join('')}${isLast[i] ? '└── ' : '├── '}${name}`);
  }
  return lines.join('\n');
}

async function generateArchitectureMarkdown() {
  const rootDir = process.cwd();
  const rootName = path.basename(rootDir);
  const productName = resolveProductName(rootDir);

  // 1. Load repomix.config.json and merge with defaults (same merge the CLI performs).
  const fileConfig = await loadFileConfig(rootDir, null);
  const config = mergeConfigs(rootDir, fileConfig, {});

  // Architecture map only — never emit file contents, only structure + metadata.
  config.output.files = false;
  // Deterministic and fast: no git-change sorting, no secret scanning needed
  // (we never render file contents, only paths and stats).
  config.output.git.sortByChanges = false;
  config.security.enableSecurityCheck = false;

  // 2. Gitignore-aware full file list (includes binary assets such as icons).
  const search = await searchFiles(rootDir, config);

  // 3. Run the Repomix pipeline for per-file metadata (chars, tokens, content).
  //    `produceOutput` is short-circuited: we only consume structured metadata,
  //    not the generated artifact repomix would otherwise write to disk.
  const result: PackResult = await pack([rootDir], config, () => {}, {
    produceOutput: async () => ({ outputForMetrics: '' }),
  });

  // 4. Union of every known path: search results (all files), safe text files,
  //    and skipped/binary files (icons, oversized assets).
  const filePaths = [
    ...new Set([
      ...search.filePaths,
      ...result.safeFilePaths,
      ...result.skippedFiles.map((f) => f.path),
    ]),
  ].toSorted((a, b) => toPosix(a).localeCompare(toPosix(b)));

  // 5. Box-drawing directory tree with the dynamic repository root label.
  const emptyDirs = config.output.includeEmptyDirectories ? search.emptyDirPaths : [];
  const tree = toBoxDrawingTree(generateTreeString(filePaths, emptyDirs));

  // 6. Per-file metadata lookups, keyed by POSIX path.
  const contentByPath = new Map(result.processedFiles.map((f) => [toPosix(f.path), f.content]));
  const tokenCounts = new Map(
    Object.entries(result.fileTokenCounts).map(([k, v]) => [toPosix(k), v])
  );
  const charCounts = new Map(
    Object.entries(result.fileCharCounts).map(([k, v]) => [toPosix(k), v])
  );

  // 7. Aggregate real content metrics. Note: `result.totalTokens`/`totalCharacters`
  //    reflect the rendered output (near-empty with `output.files: false`), so the
  //    true totals are computed by summing the per-file metric maps instead.
  const totalChars = [...charCounts.values()].reduce((sum, v) => sum + v, 0);
  const totalTokens = [...tokenCounts.values()].reduce((sum, v) => sum + v, 0);

  // 8. Build the inventory table: path + Repomix metadata + 1-line description.
  const fileRows: string[] = [];
  for (const filePath of filePaths) {
    const posix = toPosix(filePath);
    const absPath = path.join(rootDir, filePath);
    const size = fs.statSync(absPath, { throwIfNoEntry: false })?.size ?? 0;
    const content = contentByPath.get(posix);
    const lines = content !== undefined ? content.split('\n').length : '—';
    const tokens = tokenCounts.get(posix) ?? '—';
    const chars = charCounts.get(posix) ?? '—';
    const desc = fileDescriptions[posix] ?? 'Source or configuration file for the application.';
    fileRows.push(
      `| \`${posix}\` | ${formatBytes(size)} | ${lines} | ${tokens} | ${chars} | ${desc} |`
    );
  }

  const content = `# Project Architecture Overview

This document provides a single-file summary of the **${productName}** architecture. The directory tree and per-file metadata are generated by the [Repomix](https://repomix.com) \`pack()\` API (\`scripts/generate-arch.ts\`), then post-processed with 1-line descriptions.

> [!NOTE]
> This file contains the complete directory tree and a metadata inventory (size, lines, tokens, characters) of every file in the project. Full code contents are omitted to keep the architecture map concise.

---

## 1. Directory Structure

\`\`\`
${rootName}/
${tree}
\`\`\`

---

## 2. File Inventory & Descriptions

Repomix metrics: **${result.totalFiles} files · ${formatBytes(totalChars)} · ${totalTokens.toLocaleString()} tokens** (text files; binary assets are listed without content metrics).

| File Path | Size | Lines | Tokens | Chars | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
${fileRows.join('\n')}

---

## 3. Technology Stack & Data Flow

- **Frontend Layer**: Built with **SolidJS 2** and **TypeScript**, styled using a 100% AMOLED deep black theme with glassmorphic cards.
- **Desktop Container**: Powered by **Tauri v2**, executing cross-platform GUI & native system tray integration.
- **Backend & Native Integrations**: Written in **Rust (Cargo)**, handling taskbar tray context menus ("Open", "Check for Updates", "Quit"), window close intercept (\`CloseRequested\`), OS autostart via \`@tauri-apps/plugin-autostart\`, and auto-updater via \`@tauri-apps/plugin-updater\`.
- **Architecture Map**: Generated by the **Repomix** \`pack()\` API (gitignore-aware file collection, per-file token/char metrics, directory tree) with descriptions merged by \`scripts/generate-arch.ts\`.
- **Package Manager & CLI**: Run and tested using **Bun.js** via the single primary command:
  \`\`\`bash
  bun run tauri dev
  \`\`\`
`;

  fs.writeFileSync(path.join(rootDir, 'ARCHITECTURE.md'), content, 'utf8');
  console.log(
    `ARCHITECTURE.md generated via Repomix pack() API (${result.totalFiles} files, ${totalTokens.toLocaleString()} tokens).`
  );
}

generateArchitectureMarkdown();
