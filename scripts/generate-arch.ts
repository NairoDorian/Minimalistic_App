import fs from 'node:fs';
import path from 'node:path';

// 1-line description registry for files in the repository
const fileDescriptions: Record<string, string> = {
  "package.json": "Project manifest containing Bun scripts, dependencies (React 19, Tauri v2), and repomix configuration.",
  "tsconfig.json": "TypeScript root configuration with strict type checking and bundler resolution.",
  "vite.config.ts": "Vite bundler configuration optimized for React 19 and Tauri v2 dev server integration.",
  "index.html": "Main HTML entry point featuring Google Fonts Inter and root mount target.",
  "repomix.config.json": "Repomix configuration file for generating architecture and directory metadata.",
  "README.md": "User manual and documentation specifying feature list and 'bun run tauri dev' command.",
  "CHANGELOG.md": "Version history tracking releases and features starting with v0.1.0.",
  "AGENTS.md": "Guidelines and technical context for AI coding agents operating on this repository.",
  "ARCHITECTURE.md": "Generated single file architecture map listing directory structure and file descriptions.",
  "src/main.tsx": "React 19 application entry point rendering App root inside StrictMode.",
  "src/App.tsx": "Single-tab settings GUI with toggles for OS launch autostart and tray minimize behavior.",
  "src/index.css": "100% AMOLED deep black theme (#000000) with glassmorphism and glowing toggle switches.",
  "src-tauri/Cargo.toml": "Cargo manifest declaring Rust dependencies: tauri v2, tauri-plugin-autostart, and serde.",
  "src-tauri/tauri.conf.json": "Tauri v2 configuration defining window dimensions, security capabilities, and tray bundle.",
  "src-tauri/build.rs": "Rust build script initializing Tauri build environment.",
  "src-tauri/capabilities/default.json": "Tauri v2 capability definitions granting autostart, store, and tray permissions.",
  "src-tauri/src/lib.rs": "Core Rust backend implementing System Tray menu ('Open', 'Quit'), autostart, and window hide event intercept.",
  "src-tauri/src/main.rs": "Main Rust entry point launching the lib run loop without extra Windows console.",
  "scripts/generate-arch.ts": "Script utilizing Repomix logic to output ARCHITECTURE.md with directory tree and 1-line descriptions.",
  "scripts/create-icons.ts": "Utility script for generating default application icons for Tauri v2."
};

function getDirectoryTree(dir: string, prefix = ''): string {
  let output = '';
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  const ignoredNames = new Set([
    'node_modules', 'target', 'dist', '.git', 'bun.lock', 'bun.lockb', '.DS_Store'
  ]);

  const filtered = entries.filter(e => !ignoredNames.has(e.name));

  filtered.forEach((entry, index) => {
    const isLast = index === filtered.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';

    output += `${prefix}${connector}${entry.name}\n`;

    if (entry.isDirectory()) {
      output += getDirectoryTree(path.join(dir, entry.name), prefix + childPrefix);
    }
  });

  return output;
}

function generateArchitectureMarkdown() {
  const rootDir = process.cwd();
  const tree = getDirectoryTree(rootDir);

  // Collect all tracked files
  const fileRows: string[] = [];

  function collectFiles(dir: string, relPath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const ignoredNames = new Set([
      'node_modules', 'target', 'dist', '.git', 'bun.lock', 'bun.lockb', '.DS_Store'
    ]);

    entries.filter(e => !ignoredNames.has(e.name)).forEach(entry => {
      const relativeFilePath = relPath ? `${relPath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        collectFiles(path.join(dir, entry.name), relativeFilePath);
      } else {
        const desc = fileDescriptions[relativeFilePath] || "Source or configuration file for the application.";
        fileRows.push(`| \`${relativeFilePath}\` | ${desc} |`);
      }
    });
  }

  collectFiles(rootDir);

  const content = `# Project Architecture Overview

This document provides a single-file summary of the **Minimalistic App** architecture, generated via Repomix integration.

> [!NOTE]
> This file contains the complete directory tree and a 1-line description of every file in the project. Full code contents are omitted to keep the architecture map concise.

---

## 1. Directory Structure

\`\`\`
minimalistic-app/
${tree}\`\`\`

---

## 2. File Inventory & Descriptions

| File Path | Description |
| :--- | :--- |
${fileRows.join('\n')}

---

## 3. Technology Stack & Data Flow

- **Frontend Layer**: Built with **React 19** and **TypeScript**, styled using a 100% AMOLED deep black theme with glassmorphic cards.
- **Desktop Container**: Powered by **Tauri v2**, executing cross-platform GUI & native system tray integration.
- **Backend & Native Integrations**: Written in **Rust (Cargo)**, handling taskbar tray context menus ("Open", "Quit"), window close intercept (\`CloseRequested\`), and OS autostart via \`@tauri-apps/plugin-autostart\`.
- **Package Manager & CLI**: Run and tested using **Bun.js** via the single primary command:
  \`\`\`bash
  bun run tauri dev
  \`\`\`
`;

  fs.writeFileSync(path.join(rootDir, 'ARCHITECTURE.md'), content, 'utf8');
  console.log("ARCHITECTURE.md successfully generated!");
}

generateArchitectureMarkdown();
