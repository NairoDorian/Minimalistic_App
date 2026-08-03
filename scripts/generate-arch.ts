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
  ".gitignore": "Git ignore configuration excluding build artifacts, node_modules, and OS metadata.",
  ".github/workflows/ci.yml": "Cross-platform GitHub Actions CI validating TypeScript, Vite bundling, and Cargo check on Linux, macOS, and Windows.",
  "package.json": "Project manifest containing Bun scripts (dev, build, typecheck, arch, create-icons, update-deps, clean), dependencies (React 19, Tauri v2), and TypeScript tooling.",
  "repomix.config.json": "Repomix configuration for metadata-only architecture output (gitignore-aware, no file contents).",
  "tsconfig.json": "TypeScript root configuration with strict type checking, bundler resolution, and enforced noUnusedLocals.",
  "tsconfig.scripts.json": "Separate TypeScript config for Node.js scripts — uses ES2022 lib without DOM types to avoid type collisions.",
  "vite.config.ts": "Vite bundler configuration optimized for React 19 and Tauri v2 dev server integration, injecting __APP_VERSION__ at build time.",
  "index.html": "Main HTML entry point featuring Google Fonts Inter and root mount target.",
  "README.md": "User manual and documentation specifying feature list, SOP procedure, and 'bun run tauri dev' command.",
  "CHANGELOG.md": "Version history tracking releases and features starting with v0.1.0.",
  "AGENTS.md": "Guidelines, SOP procedure, and technical context for AI coding agents operating on this repository.",
  "AUTO-UPDATE.md": "Documentation and setup guide for GitHub Releases auto-updater and release CI/CD workflow.",
  "src/main.tsx": "React 19 application entry point rendering App root (no React import needed with JSX transform).",
  "src/App.tsx": "Application shell: modular tab navigation (ARIA tabs), header with drag region, footer status bar, and app-info IPC loading.",
  "src/vite-env.d.ts": "Vite client type references and declaration of the build-time __APP_VERSION__ constant.",
  "src/lib/tauri.ts": "Shared Tauri v2 runtime detection utility exporting the isTauri constant.",
  "src/components/ToggleSwitch.tsx": "Reusable accessible ARIA toggle switch (role=switch, Space/Enter keys, visually-hidden checkbox) used by the Preferences tab.",
  "src/components/UpdateChecker.tsx": "Auto-update checker component handling release checks, streamed progress, and app relaunch.",
  "src/components/PreferencesTab.tsx": "Preferences tab panel owning autostart and minimize-to-tray toggle state, handlers, and the embedded update checker card.",
  "src/components/AboutTab.tsx": "Presentational System & About tab panel; exports the AppInfo interface and WEB_PREVIEW_APP_INFO fallback.",
  "src/index.css": "100% AMOLED deep black theme (#000000) with glassmorphism, glowing toggle switches, and reduced-motion support.",
  "src-tauri/Cargo.toml": "Cargo manifest declaring Rust dependencies: tauri v2, autostart, updater, process, serde, and serde_json.",
  "src-tauri/tauri.conf.json": "Tauri v2 configuration defining window dimensions, updater endpoints, and tray bundle.",
  "src-tauri/build.rs": "Rust build script initializing Tauri build environment.",
  "src-tauri/capabilities/default.json": "Tauri v2 capability definitions granting autostart, updater, process, and tray permissions.",
  "src-tauri/src/lib.rs": "Core Rust backend implementing System Tray menu ('Open', 'Check for Updates', 'Quit'), autostart, IPC settings persistence, and window hide event intercept.",
  "src-tauri/src/main.rs": "Main Rust entry point launching the lib run loop without extra Windows console.",
  "src-tauri/icons/32x32.png": "Application tray/window icon at 32x32 pixels.",
  "src-tauri/icons/128x128.png": "Application icon at 128x128 pixels.",
  "src-tauri/icons/128x128@2x.png": "HiDPI application icon at 256x256 pixels (128x128 @2x).",
  "src-tauri/icons/icon.png": "512x512 master application icon.",
  "src-tauri/icons/icon.ico": "Multi-resolution Windows icon container (16/32/48/64/128/256).",
  "src-tauri/icons/icon.icns": "Valid macOS Apple Icon Image container (icp4-ic15, base + retina).",
  "scripts/generate-arch.ts": "Repomix pack() API-driven generator producing ARCHITECTURE.md with tree and per-file metadata inventory.",
  "scripts/create-icons.ts": "Cross-platform icon generator producing multi-size PNG, multi-entry ICO, and valid ICNS assets for Tauri v2.",
  "scripts/update-deps.ts": "End-to-end automated update & build validation pipeline script for Bun packages & Cargo crates.",
  "scripts/version.ts": "Global single source of truth for the application version (APP_VERSION constant) consumed by vite.config.ts and before-commit.ts.",
  "scripts/before-commit.ts": "Version synchronization & validation script propagating APP_VERSION to package.json, Cargo.toml, and tauri.conf.json with --check, --bump, and --install-hook modes.",
  "src-tauri/Cargo.lock": "Rust dependency lockfile, committed to track exact crate versions for reproducible builds."
};

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
  const isLast = new Array<boolean>(entries.length).fill(true);
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
  ].sort((a, b) => toPosix(a).localeCompare(toPosix(b)));

  // 5. Box-drawing directory tree with the dynamic repository root label.
  const emptyDirs = config.output.includeEmptyDirectories ? search.emptyDirPaths : [];
  const tree = toBoxDrawingTree(generateTreeString(filePaths, emptyDirs));

  // 6. Per-file metadata lookups, keyed by POSIX path.
  const contentByPath = new Map(
    result.processedFiles.map((f) => [toPosix(f.path), f.content])
  );
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
    fileRows.push(`| \`${posix}\` | ${formatBytes(size)} | ${lines} | ${tokens} | ${chars} | ${desc} |`);
  }

  const content = `# Project Architecture Overview

This document provides a single-file summary of the **Minimalistic App** architecture. The directory tree and per-file metadata are generated by the [Repomix](https://repomix.com) \`pack()\` API (\`scripts/generate-arch.ts\`), then post-processed with 1-line descriptions.

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

- **Frontend Layer**: Built with **React 19** and **TypeScript**, styled using a 100% AMOLED deep black theme with glassmorphic cards.
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
