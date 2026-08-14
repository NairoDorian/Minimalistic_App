/**
 * Shared Tauri v2 runtime detection utility.
 *
 * Evaluated once at module load time. Returns true when the frontend is
 * running inside the native Tauri desktop webview (window.__TAURI_INTERNALS__
 * is injected by Tauri v2 at startup), and false in browser-only dev preview.
 *
 * Import this instead of inlining the check in every component.
 */
export const isTauri: boolean = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
