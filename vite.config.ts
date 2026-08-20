import { defineConfig } from 'vite';
import solid from '@solidjs/vite-plugin';
import { APP_VERSION } from './scripts/version.ts';

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [solid()],

  // Vite options tailored for Tauri development
  clearScreen: false,

  // Injected at build time so the browser-preview fallback in App.tsx can never
  // drift from the single source of truth: scripts/version.ts (APP_VERSION).
  // See scripts/before-commit.ts for the sync pipeline keeping the other
  // version mirrors (package.json, Cargo.toml, tauri.conf.json) identical.
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },

  build: {
    // Target the embedded webview baseline (Chromium 105 / WebView2 on Windows,
    // modern WKWebView & WebKitGTK on macOS/Linux) — avoids unnecessary
    // transpilation of ES features the embedded browser already supports natively.
    target: ['chrome105'],
  },

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    // Conditionally spread `hmr` so it is omitted (Vite's default) when there is
    // no Tauri dev host, rather than assigned `undefined` — the latter violates
    // exactOptionalPropertyTypes and would also disable HMR on plain localhost.
    ...(host ? { hmr: { protocol: 'ws', host, port: 1421 } } : {}),
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
});
