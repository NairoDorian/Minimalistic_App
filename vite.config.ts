import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // Vite options tailored for Tauri development
  clearScreen: false,

  // Injected at build time so the browser-preview fallback in App.tsx can never
  // drift from the version declared in package.json (single source of truth).
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  build: {
    // Target the embedded webview baseline (Chromium 105 / WebView2 on Windows,
    // modern WKWebView & WebKitGTK on macOS/Linux) — avoids unnecessary
    // transpilation of ES features the embedded browser already supports natively.
    target: ["chrome105"],
  },

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
