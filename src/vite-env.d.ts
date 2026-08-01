/// <reference types="vite/client" />

// Application version string injected by Vite's `define` at build time
// (see vite.config.ts). Single source of truth: scripts/version.ts
// (APP_VERSION) — synced across package.json / Cargo.toml / tauri.conf.json
// by `bun run before-commit` (scripts/before-commit.ts).
declare const __APP_VERSION__: string;
